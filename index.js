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

    // USERS related apis
    
    app.get("/api/users/:userId", async (req, res) => {
      try {
        const userId = req.params.userId;
        const query = { _id: new ObjectId(userId) };
        
        const result = await usersCollection.findOne(query);
        if (!result) {
          return res.status(404).json({ message: "User identity document record not found" });
        }
        
        res.json(result);
      } catch (error) {
        console.error("Error fetching single user context details:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });


    app.patch("/api/users/profile", async (req, res) => {
    try {
      const { userId, name, phoneNumber, gender, image, accountRole } = req.body;

      const filter = { _id: new ObjectId(userId) };

      const updateDoc = {
        $set: {
          name: name,
          phoneNumber: phoneNumber,
          gender: gender?.toLowerCase(),
          image: image, 
          updatedAt: new Date() 
        }
      };

      console.log(`Executing Semantic PATCH Profile Update for User ID: ${userId}`);
      const result = await usersCollection.updateOne(filter, updateDoc);

      if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Target user account document was not found" });
      }

      res.send(result);

    } catch (error) {
      console.error("Critical error inside patient user patching transaction:", error);
      res.status(500).send({ error: "Internal Server Error updating database collection" });
    }
    });
    

    // DOCTORS related apis
    app.get('/api/doctors', async (req, res) => {
    try {
        console.log('Doctors Filtering params:', req.query);
        const query = {};

        // 1. Regex Text Searching Match
        if (req.query.search) {
            query.doctorName = { $regex: req.query.search, $options: 'i' };
        }

        // 2. Exact Medical Specialty Match
        if (req.query.specialty && req.query.specialty !== 'all') {
            // Converting normalized slugs back if needed e.g. 'general-medicine' to regex/string
            const searchPattern = req.query.specialty.replace('-', ' ');
            query.specialization = { $regex: searchPattern, $options: 'i' };
        }

        // 3. Setup Sorting Strategies
        let sortOption = {};
        if (req.query.sortBy) {
            if (req.query.sortBy === 'fee-asc') sortOption.consultationFee = 1;
            if (req.query.sortBy === 'fee-desc') sortOption.consultationFee = -1;
            if (req.query.sortBy === 'experience-desc') sortOption.experience = -1;
        } else {
            sortOption.consultationFee = 1; // Default fallback sorting
        }

        // 4. Executing Cursor Pagination Matching Jobs Framework
        const page = parseInt(req.query.page, 10) || 1;
        const perPage = parseInt(req.query.perPage, 10) || 12;
        const skipItems = (page - 1) * perPage;

        const total = await doctorsCollection.countDocuments(query);

        const cursor = doctorsCollection.find(query)
            .sort(sortOption)
            .skip(skipItems)
            .limit(perPage);
            
        const doctors = await cursor.toArray();
        return res.send({ total, doctors });

    } catch (error) {
        console.error("Failed to fetch clinicians catalog:", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
    });

    app.get("/api/doctors/featured", async (req, res) => {
        const result = await doctorsCollection.find().limit(4).toArray();
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

    app.get('/api/doctors/details/:id', async (req, res) => {
      try {
        const id = req.params.id;
        
        const query = { _id: new ObjectId(id) };
        const result = await doctorsCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Doctor profile not found" });
        }
        res.send(result);

      } catch (error) {
        console.error("Error fetching doctor details:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
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


    app.patch("/api/doctors/schedule/:userId", async (req, res) => {
        const { userId } = req.params;
        const { availableDays, availableSlots } = req.body;

        if (!userId) {
          return res.status(400).send({ message: "User ID is required to update schedule" });
        }

        const filter = { userId: userId };
        const updateDoc = {
          $set: {
            availableDays: availableDays || [],
            availableSlots: availableSlots || [],
            // updatedAt: new Date()
          }
        };

        const result = await doctorsCollection.updateOne(filter, updateDoc);
        
        res.send(result);
    });


    // reviews related apis
    app.get('/api/reviews/:doctorId', async (req, res) => {
      try {
        const { doctorId } = req.params;
        const query = { doctorId: doctorId };
        const reviews = await reviewsCollection.find(query).toArray();
        res.send(reviews);
      } 
      catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });


    // stats related apis
    app.get('/api/overview-stats', async (req, res) => {
      try {
          // Query counts in parallel for optimal database response latency
          const [totalDoctors, totalPatients, totalAppointments, totalReviews] = await Promise.all([
              usersCollection.countDocuments({ accountRole: "medical_specialist" }),
              usersCollection.countDocuments({ accountRole: "patient_family" }),
              appointmentsCollection.countDocuments({}),
              reviewsCollection.countDocuments({})
          ]);

          res.send({
              totalDoctors,
              totalPatients,
              totalAppointments,
              totalReviews
          });
      } catch (error) {
          console.error("Failed to compile dashboard aggregate matrix counter:", error);
          res.status(500).send({ error: "Internal Server Error compiling platform statistics" });
      }
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