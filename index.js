const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express');
const dotenv = require("dotenv");
dotenv.config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const cors = require("cors");
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    const prescriptionsCollection = database.collection("prescriptions");



    // ----  APIs ----

    // USERS related apis
    app.get("/api/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    
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

      const existingDoctor = await doctorsCollection.findOne(filter);
    const existingPriceId = existingDoctor?.stripePriceId || null;

      const updateDoc = {
        $set: {
          ...doctorData,
          stripePriceId: existingPriceId,
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


    // docotr dashboard appointment and prescription related apis
    app.get("/api/doctor/appointments/:userId", async (req, res) => {
      try {
        const { userId } = req.params;

        const doctorProfile = await doctorsCollection.findOne({ userId: userId });
    
      if (!doctorProfile) {
        return res.status(204).json({ success: true, data: [] });
      }

        const appointments = await appointmentsCollection.aggregate([
          { 
            $match: { 
              doctorId: String(doctorProfile._id),
              paymentStatus: "paid"
            } 
          },
          { $sort: { 
              appointmentDate: 1, 
              appointmentTime: 1 
            } 
          },
          {
            $addFields: {
              patientObjId: { $toObjectId: "$patientId" }
            }
          },
          {
            $lookup: {
              from: "user",
              localField: "patientObjId",
              foreignField: "_id",
              as: "patientDetails"
            }
          },
          {
            $unwind: {
              path: "$patientDetails",
              preserveNullAndEmptyArrays: true
            }
          }
        ]).toArray();

        return res.status(200).json({ success: true, data: appointments });
      } catch (error) {
        console.error("Error fetching doctor appointments:", error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });


    app.get("/api/doctor/prescriptions/list/:doctorId", async (req, res) => {
      try {
        const { doctorId } = req.params;
        
        const logs = await prescriptionsCollection.aggregate([
          { 
            $match: { 
              doctorId: doctorId 
            } 
          },
          { 
            $sort: { 
              createdAt: -1 
            } 
          },
          { 
            $addFields: { 
              patientObjId: { $toObjectId: "$patientId" } 
            } 
          },
          {
            $lookup: {
              from: "user",
              localField: "patientObjId",
              foreignField: "_id",
              as: "patient"
            }
          },
          { 
            $unwind: { 
              path: "$patient", 
              preserveNullAndEmptyArrays: true 
            } 
          }
        ]).toArray();

        return res.status(200).json({ success: true, data: logs });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });


    app.get("/api/doctor/patient-details/:patientId", async (req, res) => {
      try {
        const { patientId } = req.params;

        const patient = await usersCollection.findOne({ 
          _id: new ObjectId(patientId) 
        });

        return res.status(200).json({ success: true, data: patient 

        });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });


    app.post("/api/doctor/prescriptions/issue", async (req, res) => {
      try {
        const { doctorId, patientId, appointmentId, diagnosis, medications, notes } = req.body;

        if (!appointmentId || !diagnosis || !medications) {
          return res.status(400).json({ success: false, error: "Missing required clinical fields." });
        }

        // Log the prescription
        const prescriptionDoc = {
          doctorId,
          patientId,
          appointmentId,
          diagnosis,
          medications,
          notes,
          createdAt: new Date()
        };

        await prescriptionsCollection.insertOne(prescriptionDoc);

        // Update appointment status payload to 'completed'
        await appointmentsCollection.updateOne(  
          { _id: new ObjectId(appointmentId) },
          { $set: { 
              appointmentStatus: "completed" 
            } 
          }
        );

        return res.status(200).json({ success: true, message: "Prescription logged & appointment closed." });
      } catch (error) {
        console.error("Prescription execution failure:", error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });


    app.patch("/api/doctor/appointments/:appointmentId/status", async (req, res) => {
      try {
        const { appointmentId } = req.params;
        const { status } = req.body;

        if (!["accepted", "completed"].includes(status)) {
          return res.status(400).json({ success: false, error: "Invalid status state transition." });
        }

        const result = await appointmentsCollection.updateOne(
          { 
            _id: new ObjectId(appointmentId) 
          },
          { 
            $set: { 
              appointmentStatus: status 
            } 
          }
        );

        return res.status(200).json({ success: true, data: result });
      } catch (error) {
        console.error("Failed updating appointment state status:", error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });




    // ADMIN related apis
    app.get("/api/admin/users", async (req, res) => {
      
      const users = await usersCollection.find({}).sort({ createdAt: -1 }).toArray();

      res.send(users || []);
    });

    app.get("/api/admin/doctors", async (req, res) => {
      const doctors = await doctorsCollection.find({}).toArray();
      res.send(doctors || []);
    });


    app.patch("/api/admin/users/status/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: status,
            updatedAt: new Date()
          }
        };

        const result = await usersCollection.updateOne(filter, updateDoc);
        
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Target account record not found" });
        }

        res.send({ success: true, modifiedCount: result.modifiedCount });

      } catch (error) {
        console.error("Failed to update user account status:", error);
        res.status(500).send({ error: "Internal Server Error updating status code" });
      }
    });


    app.patch("/api/admin/doctors/verify/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { verificationStatus } = req.body;

        const filter = { _id: new ObjectId(id) };

        const doctor = await doctorsCollection.findOne(filter);
    if (!doctor) {
      return res.status(404).send({ message: "Practitioner record identity not found" });
    }

        let targetPriceId = doctor.stripePriceId || null;

        if (verificationStatus === "Approved" && !targetPriceId) {
      console.log(`Automating Stripe Item generation for clinician: ${doctor.doctorName}`);


      // Create product on Stripe
      const stripeProduct = await stripe.products.create({
        name: `Appointment with ${doctor.doctorName}`,
        description: `${doctor.specialization} Specialist Consultation - Medicare Connect`,
        images: doctor.profileImage ? [doctor.profileImage] : []
      });

      // Create consultation base fee price (Multiplied by 100 to convert dollars to cents)
      const stripePrice = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: Math.round(parseFloat(doctor.consultationFee) * 100),
        currency: "usd",
      });

      targetPriceId = stripePrice.id;
    }

        const updateDoc = {
          $set: {
            verificationStatus: verificationStatus,
            stripePriceId: targetPriceId,
            updatedAt: new Date()
          }
        };

        const result = await doctorsCollection.updateOne(filter, updateDoc);
        
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Medical Specialist's record not found" });
        }

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Failed to update verification status:", error);
        res.status(500).send({ error: "Internal Server Error updating license validation status" });
      }
    });


    // Appointment related apis
    app.get("/api/appointments/patient/:patientId", async (req, res) => {
      const { patientId } = req.params;
      
      const appointments = await appointmentsCollection.aggregate([
        {
          $match: {
            patientId: patientId
          }
        },
        {
          $addFields: {
            docObjId: {
              $toObjectId: "$doctorId"
            }
          }
        },
        {
          $lookup: {
            from: "doctors",
            localField: "docObjId",
            foreignField: "_id",
            as: "doctorDetails"
          }
        },
        {
          $unwind: {
            path: "$doctorDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $sort: {
            createdAt: -1
          }
        }
      ]).toArray();

      return res.status(200).json({ success: true, data: appointments });
    });


    app.post("/api/appointments/book", async (req, res) => {
      try {
        const { 
          patientId, 
          doctorId, 
          appointmentDate, 
          appointmentTime, 
          appointmentStatus, 
          symptoms, 
          paymentStatus 
        } = req.body;

        // Basic Validation check
        if (!doctorId || !appointmentDate || !appointmentTime) {
          return res.status(400).send({ message: "Missing required core scheduling information." });
        }

        const appointmentPayload = {
          patientId: patientId || "mock-patient-123", // Replaced with authenticated user id when context is ready
          doctorId: doctorId,
          appointmentDate: appointmentDate,
          appointmentTime: appointmentTime,
          appointmentStatus: appointmentStatus || "pending",
          symptoms: symptoms || "",
          paymentStatus: paymentStatus || "unpaid", // "paid" or "unpaid"
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await appointmentsCollection.insertOne(appointmentPayload);
        
        res.status(201).send({ 
          success: true, 
          message: "Appointment successfully committed to database registry.",
          appointmentId: result.insertedId 
        });

      } catch (error) {
        console.error("Failed to insert appointment:", error);
        res.status(500).send({ error: "Internal Server Error saving appointment entry." });
      }
    });


    app.post("/api/appointments/fulfill-paid", async (req, res) => {
      try {
        const { 
          appointmentId,
          patientId, 
          doctorId, 
          appointmentDate, 
          appointmentTime, 
          symptoms, 
          amount, 
          transactionId 
        } = req.body;

        // Check if this transaction has already been logged
        const existingPayment = await paymentsCollection.findOne({ transactionId });
        if (existingPayment) {
          return res.status(200).json({ success: true, message: "Transaction already processed." });
        }

        let targetAppointmentId = appointmentId;

        if (appointmentId && appointmentId !== "null" && appointmentId !== "undefined") {
          const updateResult = await appointmentsCollection.updateOne(
            { 
              _id: new ObjectId(appointmentId) 
            }, 
            { 
              $set: { 
                paymentStatus: "paid",
                updatedAt: new Date()
              } 
            }
          );

          if (updateResult.matchedCount === 0) {
            return res.status(404).json({ success: false, error: "Dashboard appointment record not found." });
          }
        }

        else {
        // Insert the new paid appointment into appointmentsCollection
          const appointmentPayload = {
            patientId,
            doctorId,
            appointmentDate,
            appointmentTime,
            symptoms: symptoms || "",
            appointmentStatus: "pending", 
            paymentStatus: "paid",
            createdAt: new Date()
          };

          const insertResult = await appointmentsCollection.insertOne(appointmentPayload);
          targetAppointmentId = insertResult.insertedId.toString();
        }

        
        // Log the completed payment record into paymentsCollection
        const paymentPayload = {
          appointmentId: targetAppointmentId,
          patientId,
          doctorId,
          amount: Number(amount),
          transactionId,
          paymentDate: new Date()
        };

        await paymentsCollection.insertOne(paymentPayload);

        return res.status(201).json({ 
          success: true, 
          message: "Appointment and payment records successfully saved." 
        });

      } catch (error) {
        console.error("Express database fullfilment error:", error);
        return res.status(500).json({ error: "Internal database write routine failure." });
      }
    });


    // Payments related apis
    app.get("/api/payments/patient/:patientId", async (req, res) => {
      try {
        const { patientId } = req.params;

        const payments = await paymentsCollection.aggregate([
          {
            $match: {
              patientId: patientId
            }
          },
          {
            $addFields: {
              docObjId: { 
                $toObjectId: "$doctorId" 
              }
            }
          },
          {
            $lookup: {
              from: "doctors",
              localField: "docObjId",
              foreignField: "_id",
              as: "doctorDetails"
            }
          },
          {
            $unwind: {
              path: "$doctorDetails",
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $sort: {
              "paymentDate": -1,
            }
          }
        ]).toArray();

        return res.status(200).json({ success: true, data: payments });
      } catch (error) {
        console.error("Failed aggregating payment history:", error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });


    // Reviews related apis
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


    app.get("/api/reviews/patient/:patientId", async (req, res) => {
      try {
        const { patientId } = req.params;

        const reviews = await reviewsCollection.aggregate([
          { $match: { patientId: patientId } },
          {
            $addFields: {
              docObjId: { $toObjectId: "$doctorId" }
            }
          },
          {
            $lookup: {
              from: "doctors",
              localField: "docObjId",
              foreignField: "_id",
              as: "doctorDetails"
            }
          },
          {
            $unwind: {
              path: "$doctorDetails",
              preserveNullAndEmptyArrays: true
            }
          },
          { $sort: { createdAt: -1 } }
        ]).toArray();

        return res.status(200).json({ success: true, data: reviews });
      } catch (error) {
        console.error("Aggregation error fetching reviews:", error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });


    app.post("/api/reviews", async (req, res) => {
      try {

        // console.log("Incoming Review Body Payload:", req.body);

        const { patientId, doctorId, rating, reviewText } = req.body;

        if (!patientId || !doctorId || !rating || !reviewText) {
          return res.status(400).json({ success: false, error: "Missing required payload values." });
        }

        const reviewPayload = {
          patientId,
          doctorId,
          rating: Number(rating),
          reviewText,
          createdAt: new Date()
        };

        const result = await reviewsCollection.insertOne(reviewPayload);
        return res.status(201).json({ success: true, data: result });
      } catch (error) {
        console.error("Failed inserting feedback log:", error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    app.get("/api/public/top-reviews", async (req, res) => {
      try {
        const topReviews = await reviewsCollection.aggregate([
          { 
            $limit: 3 
          },
          {
            $addFields: {
              patientObjId: { $toObjectId: "$patientId" }
            }
          },
          {
            $lookup: {
              from: "user", 
              localField: "patientObjId",
              foreignField: "_id",
              as: "patientDetails"
            }
          },
          {
            $unwind: {
              path: "$patientDetails",
              preserveNullAndEmptyArrays: true
            }
          }
        ]).toArray();

        return res.status(200).json({ success: true, data: topReviews });
      } catch (error) {
        console.error("Failed fetching public landing page reviews:", error);
        return res.status(500).json({ success: false, error: error.message });
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

    app.get("/api/patient-stats/:patientId", async (req, res) => {
      try {
        const { patientId } = req.params;

        const appointmentStats = await appointmentsCollection.aggregate([
          { 
            $match: { patientId: patientId } 
          },
          {
            $group: {
              _id: null,
              pendingCount: {
                $sum: { 
                  $cond: [{ 
                    $in: ["$appointmentStatus", ["pending", "accepted"]] 
                  }, 1, 0] 
                  // if condition true then add 1 else add 0
                }
              },
              completedCount: {
                $sum: { 
                  $cond: [{ 
                    $eq: ["$appointmentStatus", "completed"] 
                  }, 1, 0] 
                }
              }
            }
          }
        ]).toArray();

        const paymentStats = await paymentsCollection.aggregate([
          { 
            $match: { 
            patientId: patientId 
            } 
        },
          {
            $group: {
              _id: null,
              totalAmount: { $sum: "$amount" }
            }
          }
        ]).toArray();

        const totalReviews = await reviewsCollection.countDocuments({ 
          patientId: patientId 
        });

        const pending = appointmentStats[0]?.pendingCount || 0;
        const completed = appointmentStats[0]?.completedCount || 0;
        const transactionsSum = paymentStats[0]?.totalAmount || 0;

        return res.status(200).json({
          success: true,
          stats: {
            upcomingAppointments: String(pending),
            completedCheckups: String(completed),
            totalTransactions: `$${transactionsSum}`,
            totalReviews: String(totalReviews)
          }
        });

      } catch (error) {
        console.error("Failed fetching dynamic dashboard stats:", error);
        return res.status(500).json({ success: false, error: error.message });
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