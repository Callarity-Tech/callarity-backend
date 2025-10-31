import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import { v4 as uuidv4 } from "uuid"; // for unique conversation_id

export const sttController = async (req, res) => {
  try {
    const lang = req.body.lang || "en";
    const userId = req.body.user_id || "unknown_user";
    const conversationId = req.body.conversation_id || uuidv4();

    const formData = new FormData();
    formData.append("file", req.file.buffer, req.file.originalname);
    formData.append("lang", lang);

    // Send audio to STT API
    const response = await axios.post("http://localhost:8000/transcribe/", formData, {
      headers: formData.getHeaders(),
    });

    const transcribedText = response.data.text;

    const systemResponse = "ok";

    const logEntry = {
      conversation_id: conversationId,
      user_id: userId,
      started_at: new Date().toISOString(),
      dialogue: [
        {
          turn_id: 1,
          timestamp: new Date().toISOString(),
          user_input: transcribedText,
          system_response: systemResponse,
        },
      ],
      ended_at: new Date().toISOString(),
    };

    const logFile = "logs.json";

    if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, JSON.stringify([], null, 2));

    const logs = JSON.parse(fs.readFileSync(logFile, "utf-8"));

    // Check if this conversation already exists
    const existingConvIndex = logs.findIndex(
      (conv) => conv.conversation_id === conversationId
    );

    if (existingConvIndex !== -1) {
      const conv = logs[existingConvIndex];
      conv.dialogue.push({
        turn_id: conv.dialogue.length + 1,
        timestamp: new Date().toISOString(),
        user_input: transcribedText,
        system_response: systemResponse,
      });
      conv.ended_at = new Date().toISOString();
    } else {
      logs.push(logEntry);
    }

    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    res.status(200).json({
      success: true,
      conversation_id: conversationId,
      user_id: userId,
      response: systemResponse,
      text: transcribedText,
    });
  } catch (err) {
    console.error("Error in /api/stt:", err);
    res.status(500).json({ success: false, error: err.message });

    // Log error
    const errorLog = {
      timestamp: new Date().toISOString(),
      status: "failed",
      error: err.message,
    };
    fs.appendFileSync("logs.json", JSON.stringify(errorLog, null, 2) + "\n");
  }
};
