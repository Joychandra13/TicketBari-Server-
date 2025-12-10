const express = require('express');
const cors = require('cors');
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion } = require('mongodb');

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3v9uvsg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

async function run() {
  try {
    await client.connect();

    const db = client.db("TicketBari")
    const ticketCollection = db.collection("tickets");

    // All
    app.get("/tickets", async (req, res) => {
       const query = {}
            const {email} = req.query;
            // /tickets?email=''&
            if(email){
                query.vendorEmail = email;
            }


            const cursor = ticketCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
    });


    // post
    app.post("/tickets",   async (req, res) => {
      const data = req.body;
      const result = await ticketCollection.insertOne(data);
      res.send({
        success: true,
        result,
      });
    });


    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB Connected Successfully!");
  } catch (error) {
    console.log("MongoDB Connection Failed!", error.message);
  }
}
run();

app.get('/', (req, res) => {
  res.send('Ticket Bari Server Running...');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
