from fastapi import FastAPI, UploadFile, Form
from vosk import Model, KaldiRecognizer
import json
import os
from pydub import AudioSegment
import tempfile

app = FastAPI()

MODELS = {
    "en": "vosk-model-en-in-0.5"
}

@app.post("/transcribe/")
async def transcribe_audio(file: UploadFile, lang: str = Form("en")):
    try:
        with tempfile.NamedTemporaryFile(delete=False) as tmp_input_file:
            tmp_input_file.write(await file.read())
            input_path = tmp_input_file.name
        
        output_wav_path = input_path + "_converted.wav"
        
        audio = AudioSegment.from_file(input_path)
        audio = audio.set_channels(1).set_frame_rate(16000)
        audio.export(output_wav_path, format="wav")
        print(f"Converted audio saved at {output_wav_path}")
        
        model_path = MODELS.get(lang, MODELS["en"])
        if not os.path.exists(model_path):
            return {"error": f"Model path not found: {model_path}"}
        
        model = Model(model_path)
        rec = KaldiRecognizer(model, 16000)

        with open(output_wav_path, "rb") as audio_file:
            while True:
                data = audio_file.read(4000)
                if len(data) == 0:
                    break
                rec.AcceptWaveform(data)
        result = rec.Result()
        text = json.loads(result).get("text", "")

    except Exception as e:
        return {"error": str(e)}
    finally:
        if os.path.exists(input_path):
            os.remove(input_path)
      

    return {"text": text, "converted_wav_path": output_wav_path}
