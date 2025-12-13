const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const admin = require("firebase-admin");

// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;

    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3v9uvsg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("TicketBari");
    const ticketCollection = db.collection("tickets");
    const userCollection = db.collection("users");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");

    // GET /tickets/advertised
    app.get("/tickets/advertised", async (req, res) => {
      try {
        const tickets = await ticketCollection
          .find({ status: "approved", advertise: true })
          .toArray();
        res.send(tickets);
      } catch (err) {
        console.error(err);
        res.status(500).send({
          success: false,
          message: "Failed to fetch advertised tickets",
        });
      }
    });

    // GET only approved tickets
    app.get("/tickets/approved", async (req, res) => {
      try {
        const tickets = await ticketCollection
          .find({ status: "approved" })
          .toArray();
        res.send(tickets);
      } catch (err) {
        console.error(err);
        res.status(500).send({
          success: false,
          message: "Failed to fetch approved tickets",
        });
      }
    });

    // All
    app.get("/tickets", async (req, res) => {
      const query = {};
      const { email } = req.query;
      // /tickets?email=''&
      if (email) {
        query.vendorEmail = email;
      }

      const cursor = ticketCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // post
    app.post("/tickets", verifyFBToken, async (req, res) => {
      const data = req.body;
      const result = await ticketCollection.insertOne(data);
      res.send({
        success: true,
        result,
      });
    });

    //delete
    app.delete("/tickets/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ticketCollection.deleteOne(query);
      res.send(result);
    });

    //update
    app.put("/tickets/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const data = req.body;
      const objectId = new ObjectId(id);
      const filter = { _id: objectId };
      const update = { $set: data };
      const result = await ticketCollection.updateOne(filter, update);
      res.send({ success: true, result });
    });

    // booking
    app.get("/bookings", verifyFBToken, async (req, res) => {
      const query = {};
      const { email, status } = req.query;

      if (email) query.userEmail = email;
      if (status) query.status = status;

      try {
        const bookings = await bookingsCollection.find(query).toArray();
        res.send(bookings);
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to fetch bookings" });
      }
    });

    app.get("/bookings/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    // Update booking status
    app.put("/bookings/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params; // booking ID from URL
      const data = req.body; // expected: { status: "Accepted" } or { status: "Rejected" }

      try {
        const objectId = new ObjectId(id);
        const filter = { _id: objectId };
        const update = { $set: data };
        const result = await bookingsCollection.updateOne(filter, update);

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ success: false, message: "Booking not found" });
        }

        res.send({ success: true, result });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to update booking" });
      }
    });

    // Add a new booking
    app.post("/bookings", verifyFBToken, async (req, res) => {
      const booking = req.body;
      booking.createdAt = new Date();
      booking.status = "Pending";

      try {
        const result = await bookingsCollection.insertOne(booking);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Booking failed" });
      }
    });

    //payment-checkout-session
    app.post("/payment-checkout-session", verifyFBToken, async (req, res) => {
      try {
        const paymentInfo = req.body;
        const amountPerTicket = parseInt(paymentInfo.price) * 100; // per ticket in cents
        const quantity = parseInt(paymentInfo.quantity) || 1;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "bdt",
                unit_amount: amountPerTicket,
                product_data: {
                  name: `Please pay for: ${paymentInfo.ticketTitle}`,
                },
              },
              quantity: quantity,
            },
          ],
          mode: "payment",
          metadata: {
            ticketId: paymentInfo.ticketId,
            bookingId: paymentInfo.bookingId,
            ticketTitle: paymentInfo.ticketTitle,
            quantity: quantity,
          },
          customer_email: paymentInfo.userEmail,
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // payment-success
    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId)
          return res
            .status(400)
            .send({ success: false, message: "session_id required" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.send({ success: false, message: "Payment not completed" });
        }

        const bookingId = session.metadata.bookingId;
        const ticketId = session.metadata.ticketId;
        const ticketQuantityPurchased =
          parseInt(session.metadata.quantity) || 1;

        // Prevent duplicate payment processing
        const existingPayment = await paymentsCollection.findOne({
          transactionId: session.payment_intent,
        });
        if (existingPayment) {
          return res.send({
            success: true,
            message: "Payment already processed",
          });
        }

        // Update booking status
        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: { status: "paid", paidAt: new Date() } }
        );

        // Reduce ticket quantity safely
        if (ticketId) {
          // Only reduce if payment has not been processed yet
          const existingPayment = await paymentsCollection.findOne({
            transactionId: session.payment_intent,
          });

          if (!existingPayment) {
            await ticketCollection.updateOne(
              {
                _id: new ObjectId(ticketId),
                quantity: { $gte: ticketQuantityPurchased },
              },
              { $inc: { quantity: -ticketQuantityPurchased } }
            );
          }
        }

        // Record payment
        await paymentsCollection.updateOne(
          { transactionId: session.payment_intent },
          {
            $setOnInsert: {
              amount: session.amount_total / 100,
              currency: session.currency,
              customerEmail: session.customer_email,
              bookingId,
              ticketTitle: session.metadata.ticketTitle,
              transactionId: session.payment_intent,
              paymentStatus: session.payment_status,
              quantity: ticketQuantityPurchased,
              paidAt: new Date(),
            },
          },
          { upsert: true }
        );

        res.send({ success: true, transactionId: session.payment_intent });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // Get all payments for a user
    app.get("/payments", verifyFBToken, async (req, res) => {
      try {
        const { email } = req.query;

        // 1. Email required
        if (!email) {
          return res
            .status(400)
            .send({ success: false, message: "Email required" });
        }

        // 2. Email must match token email
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const payments = await paymentsCollection
          .find({ customerEmail: email })
          .toArray();

        res.send(payments);
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to fetch payments" });
      }
    });

    // users related apis
    app.get("/users", verifyFBToken, async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // update-role
    app.patch("/users/update-role/:email", verifyFBToken, async (req, res) => {
      const { email } = req.params;
      const { role } = req.body;

      await userCollection.updateOne(
        { email },
        { $set: { role, isFraud: false } } // reset fraud status
      );

      res.send({ success: true });
    });

    // update fraud
    app.patch("/users/mark-fraud/:email", verifyFBToken, async (req, res) => {
      const { email } = req.params;

      // 1. Mark user as fraud
      await userCollection.updateOne(
        { email },
        { $set: { isFraud: true, role: "vendor" } }
      );

      res.send({ success: true });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // user-role
    app.get("/users/:email/role", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    // await client.db("admin").command({ ping: 1 });
    console.log("MongoDB Connected Successfully!");
  } catch (error) {
    console.log("MongoDB Connection Failed!", error.message);
  }
}
run();

app.get("/", (req, res) => {
  res.send("Ticket Bari Server Running...");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
