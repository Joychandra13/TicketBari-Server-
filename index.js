const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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
    const bookingsCollection = db.collection("bookings");

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
