// One-off cleanup: remove the temporary "Flowcheck …" test book created
// while diagnosing the Add Book request chain.
import { MongoClient } from "mongodb";
import "dotenv/config";

const client = new MongoClient(process.env.MONGODB_URI);

try {
    await client.connect();

    const result = await client
        .db("BookNook")
        .collection("books")
        .deleteMany({ title: /^Flowcheck / });

    console.log(`Deleted ${result.deletedCount} test book(s).`);
} finally {
    await client.close();
}
