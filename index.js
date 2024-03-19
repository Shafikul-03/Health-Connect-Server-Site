const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const mg = require("nodemailer-mailgun-transport");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const pdfTemplate = require("./documents");

const port = process.env.PORT || 5000;

const app = express();

// middleware
app.use(cors());
app.use(express.json());
const uri = `mongodb+srv://Health_Connect:Health_Connect123@cluster0.zvnzmiv.mongodb.net/?retryWrites=true&w=majority`;
// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zvnzmiv.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function sendBookingEmail(booking) {
  const { email, treatment, appointmentDate, slot, patient, doctorName } =
    booking;

  const auth = {
    auth: {
      api_key: process.env.EMAIL_SEND_KEY,
      domain: process.env.EMAIL_SEND_DOMAIN,
    },
  };

  const transporter = nodemailer.createTransport(mg(auth));
  console.log("sending email", email);
  transporter.sendMail(
    {
      from: "health-connect@gmail.com", // verified sender email
      to: email || "shafiqul.cse33.bu@gmail.com", // recipient email
      subject: ` Your appointment at Health Connect has been confirmed.`, // Subject line
      text: "",
      html: `
      <h3>Your appointment is confirmed</h3>
      <div>
          <p> Dear ${patient}, Your appointment with Dr. ${doctorName} in the ${treatment} department has been confirmed </p>
          <p>Please visit us on ${appointmentDate} at ${slot}</p>
          <p>Thanks from Health Connect.</p>
      </div>
      
      `,
    },
    function (error, info) {
      if (error) {
        console.log("Email send error", error);
      } else {
        console.log(info);
      }
    }
  );
}

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("unauthorized access");
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const appointmentOptionCollection = client
      .db("healthConnect")
      .collection("appointmentOptions");
    const bookingsCollection = client
      .db("healthConnect")
      .collection("bookings");
    const usersCollection = client.db("healthConnect").collection("users");
    const doctorsCollection = client.db("healthConnect").collection("doctors");
    const paymentsCollection = client
      .db("healthConnect")
      .collection("payments");

    // NOTE: make sure you use verifyAdmin after verifyJWT
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Use Aggregate to query multiple collection and then merge data
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();

      // get the bookings of the provided date
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();

      // code carefully :D
      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    app.get("/doctors", async (req, res) => {
      try {
        const { name } = req.query;
        //const books = await appointmentOptionCollection.find({name}).toArray();
        const doctors = await doctorsCollection.find({}).toArray();
        return res.send(doctors);
      } catch (error) {
        console.log(error);
      }
    });

    app.get("/getDoctorsBySpecialty/:specialty", async (req, res) => {
      try {
        const { specialty } = req.params;
        const matchingDoctors = await doctorsCollection
          .find({ specialty })
          .toArray();
        res.json(matchingDoctors);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "An error occurred" });
      }
    });

    app.get("/v2/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const options = await appointmentOptionCollection
        .aggregate([
          {
            $lookup: {
              from: "bookings",
              localField: "name",
              foreignField: "treatment",
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$appointmentDate", date],
                    },
                  },
                },
              ],
              as: "booked",
            },
          },
          {
            $project: {
              name: 1,
              price: 1,
              slots: 1,
              booked: {
                $map: {
                  input: "$booked",
                  as: "book",
                  in: "$$book.slot",
                },
              },
            },
          },
          {
            $project: {
              name: 1,
              price: 1,
              slots: {
                $setDifference: ["$slots", "$booked"],
              },
            },
          },
        ])
        .toArray();
      res.send(options);
    });

    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {};
      const result = await appointmentOptionCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    // app.get("/bookings", verifyJWT, async (req, res) => {
    //   const email = req.query.email;
    //   const decodedEmail = req.decoded.email;
    //   if (email !== decodedEmail) {
    //     return res.status(403).send({ message: "forbidden access" });
    //   }
    //   const query = { email: email };
    //   const bookings = await bookingsCollection.find(query).toArray();
    //   res.send(bookings);
    // });

    // Later
    app.get("/bookings", async (req, res) => {
      const email = req.query.email;
      // const decodedEmail = req.decoded.email;
      // if (email !== decodedEmail) {
      //   return res.status(403).send({ message: "forbidden access" });
      // }
      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });
    app.get("/bookings/myPrescriptons", async (req, res) => {
      const email = req.query.email;
      console.log(email);

      // const decodedEmail = req.decoded.email;
      // if (email !== decodedEmail) {
      //   return res.status(403).send({ message: "forbidden access" });
      // }
      const query = { email: email, prescription: { $exists: true } };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    // Later
    app.get("/doctor/bookings", async (req, res) => {
      console.log("dhuke porechi");
      const doctorName = req.query.doctorName;
      // const decodedEmail = req.decoded.email;
      // if (email !== decodedEmail) {
      //   return res.status(403).send({ message: "forbidden access" });
      // }
      const query = { doctorName };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    // Later
    app.get("/appointmentOptions/appointmentDetails", async (req, res) => {
      const name = req.query.name;
      const result = await appointmentOptionCollection.findOne({ name: name });
      res.send(result);
    });

    app.get("/booking", async (req, res) => {
      const bookings = await bookingsCollection.find({ paid: true }).toArray();
      res.send(bookings);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;

      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment,
      };

      const alreadyBooked = await bookingsCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You already have a booking on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await bookingsCollection.insertOne(booking);
      // send email about appointment confirmation
      sendBookingEmail(booking);
      res.send(result);
    });

    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updatedResult = await bookingsCollection.updateOne(
        filter,
        updatedDoc
      );
      res.send(result);
    });

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1h",
        });
        return res.send({ accessToken: token });
      }
      res.status(403).send({ accessToken: "" });
    });

    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    // Later
    app.get("/doctors/check/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await doctorsCollection.findOne(query);
      res.send({ isDoctor: user?.isApproved === true });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // console.log(user);
      // TODO: make sure you do not enter duplicate user email
      // only insert users if the user doesn't exist in the database
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.delete("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await usersCollection.deleteOne(filter);
      res.send(result);
    });

    // Later
    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });

    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    // later
    app.put(
      "/doctors/approve/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: ObjectId(id) };
        const options = { upsert: true };
        const updatedDoc = {
          $set: {
            isApproved: true,
          },
        };
        const result = await doctorsCollection.updateOne(
          filter,
          updatedDoc,
          options
        );
        res.send(result);
      }
    );

    app.put(
      "/addPrescription",
      // verifyJWT,
      // verifyAdmin,
      async (req, res) => {
        // const id = req.params.id;
        const filter = {
          patient: req.body.patient,
          doctorName: req.body.doctorName,
        };
        const options = { upsert: true };
        // const updatedDoc = {
        //   $set: {
        //     isApproved: true,
        //   },
        // };
        const result = await bookingsCollection.updateOne(
          filter,
          { $push: { prescription: req.body } },
          options
        );
        res.send(result);
      }
    );

    // temporary to update price field on appointment options
    // app.get('/addPrice', async (req, res) => {
    //     const filter = {}
    //     const options = { upsert: true }
    //     const updatedDoc = {
    //         $set: {
    //             price: 99
    //         }
    //     }
    //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
    //     res.send(result);
    // })

    app.get("/pendingRequests", async (req, res) => {
      const query = { isApproved: false };
      console.log("Achi");
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    });
    app.get("/doctors", verifyJWT, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    });

    app.get("/doctor-list", async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection
        .find(query)
        .sort({ experience: -1 })
        .limit(3)
        .toArray();
      res.send(doctors);
    });

    // Search doctors by location
    app.get("/search-doctor", async (req, res) => {
      try {
        const { search = "", location = "" } = req.query;

        const query = {};
        if (search) {
          query.specialty = { $regex: search, $options: "i" };
        }
        if (location) {
          query.location = location;
        }

        const doctors = await doctorsCollection.find(query).toArray();

        res.json({ doctors });
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: true, message: "Internal server error" });
      }
    });

    app.get("/doctors/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const doctors = await doctorsCollection.findOne(query);
      res.send(doctors);
    });

    app.post("/doctors", async (req, res) => {
      console.log("Paici");
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });
    // app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
    //   const doctor = req.body;
    //   const result = await doctorsCollection.insertOne(doctor);
    //   res.send(result);
    // });

    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.log);

app.get("/", async (req, res) => {
  res.send("Health Connect app  server is running");
});

app.listen(port, () => console.log(`Health Connect app running on ${port}`));
