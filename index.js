const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

app.use(cors());
app.use(express.json());

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
    app.post("/tickets", async (req, res) => {
      const data = req.body;
      const result = await ticketCollection.insertOne(data);
      res.send({
        success: true,
        result,
      });
    });

    //delete
    app.delete("/tickets/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ticketCollection.deleteOne(query);
      res.send(result);
    });

    //update
    app.put("/tickets/:id", async (req, res) => {
      const { id } = req.params;
      const data = req.body;
      const objectId = new ObjectId(id);
      const filter = { _id: objectId };
      const update = { $set: data };
      const result = await ticketCollection.updateOne(filter, update);
      res.send({ success: true, result });
    });

    // booking
    app.get("/bookings", async (req, res) => {
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

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    // Update booking status
    app.put("/bookings/:id", async (req, res) => {
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
    app.post("/bookings", async (req, res) => {
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

    // payment checkout
    app.post("/payment-checkout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;
        const amount = parseInt(paymentInfo.price) * paymentInfo.quantity * 100;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "bdt",
                unit_amount: amount,
                product_data: {
                  name: `Please pay for: ${paymentInfo.ticketTitle}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            ticketId: paymentInfo.ticketId,
            bookingId: paymentInfo.bookingId,
            ticketTitle: paymentInfo.ticketTitle,
            quantity: paymentInfo.quantity
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

    // Handle payment success (PATCH to match frontend)
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
        const ticketId = session.metadata.ticketId; // Get the ticket id
        const ticketQuantityPurchased =
          parseInt(session.metadata.quantity) || 1;

        // 1. Update booking status
        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: { status: "paid", paidAt: new Date() } }
        );

        // 2. Reduce ticket quantity
        const ticket = await ticketCollection.findOne({
          _id: new ObjectId(ticketId),
        });
        if (ticket) {
          const newQuantity = ticket.quantity - ticketQuantityPurchased;
          await ticketCollection.updateOne(
            { _id: new ObjectId(ticketId) },
            { $set: { quantity: newQuantity > 0 ? newQuantity : 0 } }
          );
        }

        // 3. Record payment if not exists
        const existingPayment = await paymentsCollection.findOne({
          transactionId: session.payment_intent,
        });
        if (!existingPayment) {
          const payment = {
            amount: session.amount_total / 100,
            currency: session.currency,
            customerEmail: session.customer_email,
            bookingId,
            ticketTitle: session.metadata.ticketTitle,
            transactionId: session.payment_intent,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
          };
          await paymentsCollection.insertOne(payment);
        }

        res.send({ success: true, transactionId: session.payment_intent });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // Get all payments for a user
    app.get("/payments", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email)
          return res
            .status(400)
            .send({ success: false, message: "Email required" });

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
    app.get("/users", async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // update-role
    app.patch("/users/update-role/:email", async (req, res) => {
      const { email } = req.params;
      const { role } = req.body;

      await userCollection.updateOne(
        { email },
        { $set: { role, isFraud: false } } // reset fraud status
      );

      res.send({ success: true });
    });

    // update fraud
    app.patch("/users/mark-fraud/:email", async (req, res) => {
      const { email } = req.params;

      // 1. Mark user as fraud
      await userCollection.updateOne(
        { email },
        { $set: { isFraud: true, role: "vendor" } }
      );

      // 2. Hide vendor tickets
      await ticketCollection.updateMany(
        { vendorEmail: email },
        { $set: { status: "hidden" } }
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
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    await client.db("admin").command({ ping: 1 });
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
