import express from "express";
import cors from "cors";
import vadRouter from "../routes/vadRoutes.js";
const app = express();
const port=4000;

app.use(cors());
app.use(express.json());

app.use("/api/stt", vadRouter); 

app.get("/", (req, res) => {
  res.status(200).send("Node backend is alive and working fine!");
});

app.listen(port, () => {
  console.log(`Node server running on http://localhost:${port}`);
});