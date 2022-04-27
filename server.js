require('dotenv').config();
const express = require('express');
const app = express();

// Enable cross-origin resource sharing
// so freeCodeCamp can remotely test the app
const cors = require('cors');
app.use(cors());

// dns: Used to verify whether a hostname can be resolved
const dns = require('dns');
const dnsPromises = dns.promises;
const dnsOptions = {
  family: 4,
  hints: dns.ADDRCONFIG | dns.V4MAPPED,
};

// body-parser: Used to parse POST requests
const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }))
const httpPattern = /^https?:\/\//;

// Establish a connection to the MongoDB database
// and get a handle to the "url_shortener" collection
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.DB_URI);
let urlCollection;
async function connectToMongo() {
  try {
    //const mongoSettings = { poolSize: 50, wtimeoutMS: 2500, useNewUrlParser: true };
    //const mongoSettings = { wtimeoutMS: 2500 };
    //const client = await MongoClient.connect(process.env.FCC_DB_URI, mongoSettings);
    await client.connect();
    urlCollection = await client.db(process.env.DB_NAME)
                                .collection(process.env.DB_COLLECTION);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
connectToMongo();


// Enable serving of static assets
// process.cwd() returns current working directory
app.use('/public', express.static(`${process.cwd()}/public`));


app.get('/', function (req, res) {
  //res.sendFile(__dirname + '/views/index.html');
  res.sendFile(process.cwd() + '/views/index.html');
});


/*
When a user POSTs a URL to /api/shorturl,
the program creates an entry in its database
for that web site along with a number,
then it sends the user the JSON for that entry.

As an example, if the user gives https://freeCodeCamp.org,
the JSON returned could be as follows:
{ original_url: "https://freeCodeCamp.org", short_url: 1 }

If an invalid URL is passed, e.g. one that doesn't
follow the valid http://www.example.com format,
the JSON response will contain:
{ error: "invalid url" }
*/

async function createShortURL(userURL) {
  console.log(`\nUser entered: ${userURL}`);
  
  // Creating a URL object is one way of validating a URL.
  // However, the URL object throws an error
  // if the protocol (e.g., http) isn't in the URL string.
  // Therefore, if the URL provided by the user
  // doesn't start with http(s), add it
  // so a URL object can be created.
  if (!httpPattern.test(userURL)) {
    userURL = 'http://' + userURL;
  }

  let urlObj;
  try {
    urlObj = new URL(userURL);
  } catch (e) {
    // If the given URL is invalid,
    // a TypeError exception will be thrown.
    console.error(e);
    return { error: "invalid url" };
  }

  // Use the DNS core module to check if the host can be resolved
  let dnsResult;
  try {
    dnsResult = await dnsPromises.lookup(urlObj.hostname, dnsOptions);
    console.log(`IPv${dnsResult.family} address: ${dnsResult.address}`);
  } catch (err) {
    console.error(err);
    return { error: "invalid url" }; 
  }
  
  // Get the size of the database and convert to Base36.
  // This value will serve as the short URL.
  const dbSize = await urlCollection.countDocuments();
  const shortURL = dbSize.toString(36);
  
  // Now add the new record to the database.
  const urlSansPtcl = urlObj.href.replace(httpPattern, '');
  const newURLRecord = {
    original_url: urlSansPtcl,
    short_url: shortURL,
    times_visited: 0
  };
  const result = await urlCollection.insertOne(newURLRecord);
  
  // Check status of insertOne()
  if (result.acknowledged) {
    console.log(`New document inserted. _id: ${result.insertedId}`);
    if ('_id' in newURLRecord) {
      delete newURLRecord._id;
    }
    delete newURLRecord.times_visited;
    newURLRecord.original_url = urlObj.href;
    return newURLRecord;
  } else {
    return {error: "unable to add to database"}; 
  }
}

app.post('/api/shorturl', function (req, res) {
  if (!('url' in req.body) || req.body.url === '') {
    console.log('\nURL parameter missing.');
    res.json({error: "invalid url"});
    return;
  }
  
  let json = createShortURL(req.body.url)
    .then((json) => {
      console.log('Returning JSON object:');
      console.log(json);
      res.json(json);
    });
});


// When the user visits /api/shorturl/<short_url>,
// the user will be redirected to the web site
// that <short_url> references in the database.
app.get('/api/shorturl/:number', (req, res) => {
  if (!('number' in req.params) || req.params.number === undefined) {
    console.log('\nShort URL parameter missing.');
    res.status(404).send('No short URL was provided.');
    return;
  }
  
  console.log(`\nUser requesting page: ${req.params.number}`);
  
  // Execute the search for the URL
  urlCollection.findOne({ short_url: req.params.number })
    .then((doc) => {
      if (doc) {
        const matchFilter = { _id: doc._id };
        const updateCommand = { $inc: { times_visited: 1 } };
        // Since the URL was found in the database,
        // increment its times_visited parameter.
        urlCollection.updateOne(matchFilter, updateCommand)
          .then((result) => {
            if (result.acknowledged) {
              console.log('Successfully incremented times_visited.');
            } else {
              console.log('Failed to increment times_visited.');
            }
          })
          .finally(() => {
            console.log(`Redirecting to: ${doc.original_url}`);
            res.redirect('http://' + doc.original_url);
          });
      } else {
        console.log('The requested short URL does not exist.');
        res.status(404).send('The requested short URL does not exist.');
      }
    });
});


const port = ('PORT' in process.env) ? process.env.PORT : 3000;
app.listen(port, () => {
  console.log(`The app is listening on port ${port}.`);
});
