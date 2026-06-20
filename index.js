const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express');
const dotenv = require("dotenv");
dotenv.config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const cors = require("cors");

app.use(cors());
app.use(express.json());

const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI;

app.get('/', (req, res) => {
  res.send('Hello World!')
})



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {

    await client.connect();

    const database = client.db("medicare_connect");
    const usersCollection = database.collection("user");
    const doctorsCollection = database.collection("doctors");
    const appointmentsCollection = database.collection("appointments");
    const reviewsCollection = database.collection("reviews");
    const paymentsCollection = database.collection("payments");



    // ----  APIs ----
    
    // DOCTORS related apis
    app.get("/api/doctors", async (req, res) => {
      const result = await doctorsCollection.find().toArray();
      res.send(result);
    });

    app.get("/api/doctors/:userId", async (req, res) => {
      const userId = req.params.userId;
      const query = { userId: userId };
      const result = await doctorsCollection.findOne(query);

      if (!result) {
        return res.json(null);
      }
      res.json(result);
    });

    app.post("/api/doctors", async (req, res) => {
      const doctorData = req.body;
      const userId = doctorData.userId;

      if (!userId) {
        return res.status(400).send({ message: "User ID is required to create a doctor profile" });
      }

      const filter = { userId: userId };
      const updateDoc = {
        $set: {
          ...doctorData,
          updatedAt: new Date()
        }
      };

      // for new profile
      const options = { upsert: true };

      const result = await doctorsCollection.updateOne(filter, updateDoc, options);


      // update profile image in user collection
      if (doctorData.profileImage) {
        const userFilter = { _id: new ObjectId(userId) };
        const updateUserDoc = {
          $set: {
            image: doctorData.profileImage,
            updatedAt: new Date()
          }
        };
        await usersCollection.updateOne(userFilter, updateUserDoc);
      }

      res.send(result);
    });




    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);





app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})