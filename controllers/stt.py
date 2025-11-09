#!/usr/bin/env python3
"""
🎤 Silero VAD + Deepgram Realtime Speech-to-Text
- Detects speech locally using Silero
- Streams only speech segments to Deepgram Realtime API
- Prints live transcripts with confidence
"""

import os
import json
import torch
import sounddevice as sd
import numpy as np
import asyncio
import websockets
import ssl
import certifi
from dotenv import load_dotenv
from collections import deque
import time
from conversation_logger import ConversationLogger
os.environ["SSL_CERT_FILE"] = certifi.where()

logger = ConversationLogger(user_id="upanshi")

load_dotenv()
DG_API_KEY = os.getenv("DEEPGRAM_API_KEY")

if not DG_API_KEY:
    raise RuntimeError("❌ Missing DEEPGRAM_API_KEY in .env")

print("✅ Environment loaded")

torch.set_num_threads(1)
model, utils = torch.hub.load(
    repo_or_dir="snakers4/silero-vad",
    model="silero_vad",
    trust_repo=True
)
(get_speech_timestamps, save_audio, read_audio, VADIterator, collect_chunks) = utils

SAMPLE_RATE = 16000
BLOCK_SIZE = 512
VAD_THRESHOLD = 0.3
vad_window = deque(maxlen=20)
DG_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?punctuate=true"
    "&interim_results=true"
    "&encoding=linear16"
    "&sample_rate=16000"
    "&model=nova-2"
)

SSL_CTX = ssl.create_default_context(cafile=certifi.where())

async def send_audio_from_queue(ws, queue):
    """
    Send chunks from queue to websocket until None marker is received.
    Returns when None marker encountered (end of utterance).
    """
    while True:
        chunk = await queue.get()
        if chunk is None:
            return
        await ws.send(chunk)


async def receive_transcripts(ws):
    """Listen to Deepgram responses until the connection closes or cancelled."""
    try:
        async for msg in ws:
            data = json.loads(msg)
            if "channel" in data:
                alt = data["channel"]["alternatives"][0]
                transcript = alt.get("transcript", "")
                confidence = alt.get("confidence", 0)
                if transcript.strip():
                    print(f"🗣️ ({confidence:.2f}) {transcript}")
                    logger.add_turn(user_input=transcript, system_response=f"confidence={confidence:.2f}")

    except websockets.ConnectionClosedOK:
        return
    except Exception as e:
        if "Deepgram did not receive audio data" in str(e):
            print("ℹ️ Deepgram connection timed out (no further speech).")
        else:
            print("❌ receive_transcripts error:", e)
    return


async def mic_vad_stream(queue):
    """
    Continuously capture audio and push chunks while voice is detected.
    Puts `bytes` (PCM16) to queue; when silence after speech is detected,
    it puts `None` as an utterance-end marker.
    """
    stream_open = False

    def callback(indata, frames, time_info, status):
        nonlocal stream_open
        audio = indata[:, 0].astype(np.int16)
        audio_float = (audio.astype(np.float32) / 32768.0)
        audio_float = audio_float / max(1.0, np.max(np.abs(audio_float)))  # normalize amplitude
        audio_tensor = torch.from_numpy(audio_float)
        try:
            speech_prob = float(model(audio_tensor, SAMPLE_RATE).item())
        except Exception:
            speech_prob = 0.0
        vad_window.append(speech_prob)
        avg_prob = sum(vad_window) / len(vad_window)

        if avg_prob > VAD_THRESHOLD:
            if not stream_open:
                print("🟢 Speech detected — starting stream")
                stream_open = True
            queue.put_nowait(audio.tobytes())
        else:
            if stream_open:
                print("⚪ Speech ended — stopping stream (grace)")
                stream_open = False
                silence = np.zeros(int(SAMPLE_RATE * 1.0), dtype=np.int16)
                queue.put_nowait(silence.tobytes())
                time.sleep(0.2)
                queue.put_nowait(None)

    with sd.InputStream(
        channels=1,
        samplerate=SAMPLE_RATE,
        blocksize=BLOCK_SIZE,
        dtype="int16",
        callback=callback
    ):
        while True:
            await asyncio.sleep(0.1)

async def main():
    queue = asyncio.Queue()
    mic_task = asyncio.create_task(mic_vad_stream(queue))

    print("🎧 Mic + VAD started. Speak to create utterances...")

    try:
        while True:
            chunk = await queue.get()
            if chunk is None:
                continue

            utterance_queue = asyncio.Queue()
            await utterance_queue.put(chunk)

            try:
                async with websockets.connect(
                    DG_URL,
                    extra_headers={"Authorization": f"Token {DG_API_KEY}"},
                    ssl=SSL_CTX
                ) as ws:
                    print("✅ Connected to Deepgram Realtime API (utterance)")

                    async def funnel_global_to_uttq(utt_q, global_q):
                        while True:
                            item = await global_q.get()
                            await utt_q.put(item)
                            if item is None:
                                return

                    funnel_task = asyncio.create_task(funnel_global_to_uttq(utterance_queue, queue))
                    sender_task = asyncio.create_task(send_audio_from_queue(ws, utterance_queue))
                    receiver_task = asyncio.create_task(receive_transcripts(ws))
                    await sender_task

                    try:
                        await asyncio.wait_for(receiver_task, timeout=3)
                    except asyncio.TimeoutError:
                        receiver_task.cancel()
                    finally:
                        await funnel_task

                    print("🔁 Utterance finished — websocket closed, waiting for next speech...")

            except websockets.exceptions.ConnectionClosedError as e:
                print("⚠️ WebSocket closed with error:", e)
                await asyncio.sleep(1.0)
                continue
            except ssl.SSLError as e:
                print("❌ SSL error:", e)
                raise
            except Exception as e:
                print("❌ Unexpected error during websocket session:", e)
                await asyncio.sleep(1.0)
                continue

    except asyncio.CancelledError:
        print("🛑 main canceled")
    finally:
        mic_task.cancel()
        await asyncio.sleep(0.1)

if __name__ == "__main__":
    try:
        print("🚀 STT.py successfully triggered by Node.js")
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Exiting cleanly.")
    finally:
        logger.end_conversation()
        print(f"🧾 Conversation saved at: {logger.file_path}")

