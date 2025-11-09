import express from "express";
import { spawn } from "child_process";

const router = express.Router();

let pythonProcess = null; // keep global reference

router.post("/", async (req, res) => {
  try {
    // Prevent duplicate runs
    if (pythonProcess && !pythonProcess.killed) {
      return res.json({ message: "⚠️ STT process already running" });
    }

    console.log("📁 Current working directory:", process.cwd());

    // Spawn Python script
    pythonProcess = spawn("bash", [
      "-lc",
      "/opt/homebrew/opt/python@3.11/libexec/bin/python3 ./controllers/stt.py"
    ], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: "pipe"
    });

    // Log output from Python
    pythonProcess.stdout.on("data", (data) => {
      console.log(`[STT]: ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      console.error(`[STT Error]: ${data.toString().trim()}`);
    });

    pythonProcess.on("close", (code) => {
      console.log(`🛑 STT process exited with code ${code}`);
      pythonProcess = null; // clear reference
    });

    res.json({ message: "🚀 STT process started successfully!" });

  } catch (err) {
    console.error("❌ Error starting STT:", err);
    res.status(500).json({ error: "Failed to start STT process" });
  }
});

// 🧹 Graceful shutdown: kill Python when Node exits
process.on("SIGINT", () => {
  console.log("\n🛑 Node server stopping...");
  if (pythonProcess && !pythonProcess.killed) {
    console.log("🧹 Killing STT process...");
    pythonProcess.kill("SIGTERM");
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("🛑 Node received SIGTERM");
  if (pythonProcess && !pythonProcess.killed) {
    console.log("🧹 Killing STT process...");
    pythonProcess.kill("SIGTERM");
  }
  process.exit(0);
});

export default router;
