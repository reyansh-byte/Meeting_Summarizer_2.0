# python_model_api.py
from flask import Flask, request, jsonify
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM, pipeline
import os
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Global variables for models and tokenizers
primary_model = None
primary_tokenizer = None
fallback_summarizer = None
model_info = {"primary_loaded": False, "fallback_loaded": False, "current_model": None}

def load_models():
    global primary_model, primary_tokenizer, fallback_summarizer, model_info
    
    # Try to load your custom model first
    try:
        print("🔄 Loading your custom model...")
        model_path = "CodeXRyu/meeting-summarizer"  # or "./meeting-summarizer"
        
        primary_tokenizer = AutoTokenizer.from_pretrained(model_path)
        primary_model = AutoModelForSeq2SeqLM.from_pretrained(model_path)
        
        # Move to GPU if available
        if torch.cuda.is_available():
            primary_model = primary_model.cuda()
            print("✅ Custom model loaded on GPU")
        else:
            print("✅ Custom model loaded on CPU")
        
        model_info["primary_loaded"] = True
        model_info["current_model"] = "CodeXRyu/meeting-summarizer (custom)"
        
    except Exception as e:
        print(f"⚠️  Custom model loading failed: {e}")
        print("🔄 Loading fallback model...")
        model_info["primary_loaded"] = False
        
        # Load fallback model
        try:
            fallback_summarizer = pipeline(
                "summarization",
                model="facebook/bart-large-cnn",  # Good fallback model
                device=0 if torch.cuda.is_available() else -1
            )
            print("✅ Fallback model (BART) loaded successfully")
            model_info["fallback_loaded"] = True
            model_info["current_model"] = "facebook/bart-large-cnn (fallback)"
            
        except Exception as e2:
            print(f"⚠️  BART fallback failed: {e2}")
            print("🔄 Loading smaller fallback model...")
            
            try:
                # Even smaller fallback
                fallback_summarizer = pipeline(
                    "summarization",
                    model="sshleifer/distilbart-cnn-12-6",
                    device=0 if torch.cuda.is_available() else -1
                )
                print("✅ Small fallback model (DistilBART) loaded successfully")
                model_info["fallback_loaded"] = True
                model_info["current_model"] = "sshleifer/distilbart-cnn-12-6 (small fallback)"
                
            except Exception as e3:
                print(f"❌ All models failed to load: {e3}")
                model_info["fallback_loaded"] = False
                model_info["current_model"] = "No model available"
                raise Exception("All models failed to load")

def generate_summary_primary(text, max_length=128, context=None):
    """Generate summary using your custom fine-tuned model"""
    try:
        # Prepare input text
        if context:
            input_text = f"summarize: Meeting Context: {context}\n\nTranscript: {text}"
        else:
            input_text = f"summarize: {text}"
        
        # Tokenize input
        inputs = primary_tokenizer(
            input_text,
            max_length=256,  # Same as training
            truncation=True,
            return_tensors="pt"
        )
        
        # Move to same device as model
        if torch.cuda.is_available() and primary_model.device.type == 'cuda':
            inputs = {k: v.cuda() for k, v in inputs.items()}
        
        # Generate summary
        with torch.no_grad():
            summary_ids = primary_model.generate(
                inputs["input_ids"],
                attention_mask=inputs.get("attention_mask"),
                max_length=max_length,
                min_length=30,
                num_beams=4,
                length_penalty=1.5,
                early_stopping=True,
                do_sample=False
            )
        
        # Decode summary
        summary = primary_tokenizer.decode(summary_ids[0], skip_special_tokens=True)
        return summary
        
    except Exception as e:
        print(f"Error in generate_summary_primary: {e}")
        raise e

def generate_summary_fallback(text, max_length=128, context=None):
    """Generate summary using fallback model"""
    try:
        # Prepare input text
        if context:
            input_text = f"Meeting Context: {context}\n\nTranscript: {text}"
        else:
            input_text = text
        
        # Use fallback pipeline
        result = fallback_summarizer(
            input_text,
            max_length=min(max_length, 512),  # Ensure we don't exceed model limits
            min_length=max(30, max_length // 4),
            do_sample=False,
            num_beams=4,
            length_penalty=1.2,
            early_stopping=True
        )
        
        return result[0]['summary_text']
        
    except Exception as e:
        print(f"Error in generate_summary_fallback: {e}")
        raise e

def generate_summary(text, max_length=128, context=None):
    """Main summary function with automatic fallback"""
    # Try primary model first
    if model_info["primary_loaded"]:
        try:
            print("🤖 Using custom model...")
            return generate_summary_primary(text, max_length, context)
        except Exception as e:
            print(f"⚠️  Custom model failed: {e}")
            print("🔄 Falling back to backup model...")
    
    # Use fallback model
    if model_info["fallback_loaded"]:
        try:
            print("🤖 Using fallback model...")
            return generate_summary_fallback(text, max_length, context)
        except Exception as e:
            print(f"❌ Fallback model also failed: {e}")
            raise e
    else:
        raise Exception("No models available for summarization")

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "primary_model_loaded": model_info["primary_loaded"],
        "fallback_model_loaded": model_info["fallback_loaded"],
        "current_model": model_info["current_model"],
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "gpu_available": torch.cuda.is_available(),
        "models_info": model_info
    })

@app.route('/summarize', methods=['POST'])
def summarize():
    """Main summarization endpoint"""
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400
        
        text = data['text']
        context = data.get('context', None)
        max_length = data.get('max_length', 128)
        
        if len(text.strip()) < 10:
            return jsonify({'error': 'Text too short for summarization'}), 400
        
        # Generate summary
        summary = generate_summary(text, max_length, context)
        
        return jsonify({
            'summary': summary,
            'input_length': len(text),
            'model_used': model_info["current_model"],
            'primary_model_loaded': model_info["primary_loaded"],
            'fallback_used': not model_info["primary_loaded"]
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/batch_summarize', methods=['POST'])
def batch_summarize():
    """Batch summarization endpoint"""
    try:
        data = request.get_json()
        
        if not data or 'texts' not in data:
            return jsonify({'error': 'No texts provided'}), 400
        
        texts = data['texts']
        context = data.get('context', None)
        max_length = data.get('max_length', 128)
        
        if not isinstance(texts, list):
            return jsonify({'error': 'texts must be a list'}), 400
        
        results = []
        for i, text in enumerate(texts):
            try:
                if len(text.strip()) < 10:
                    results.append({'error': 'Text too short', 'summary': None})
                else:
                    summary = generate_summary(text, max_length, context)
                    results.append({
                        'summary': summary, 
                        'error': None,
                        'model_used': model_info["current_model"]
                    })
            except Exception as e:
                results.append({'error': str(e), 'summary': None})
        
        return jsonify({
            'results': results,
            'total_processed': len(texts),
            'primary_model_loaded': model_info["primary_loaded"],
            'model_used': model_info["current_model"]
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting Python Model API...")
    try:
        load_models()
        print(f"✅ Python API ready!")
        print(f"📊 Model Status:")
        print(f"   - Primary (Custom): {'✅ Loaded' if model_info['primary_loaded'] else '❌ Failed'}")
        print(f"   - Fallback: {'✅ Loaded' if model_info['fallback_loaded'] else '❌ Failed'}")
        print(f"   - Current Model: {model_info['current_model']}")
        print(f"   - Device: {'GPU' if torch.cuda.is_available() else 'CPU'}")
        
        if not model_info['primary_loaded'] and not model_info['fallback_loaded']:
            print("❌ CRITICAL: No models loaded! API will not work properly.")
        
        app.run(host='0.0.0.0', port=5001, debug=False)
    except Exception as e:
        print(f"❌ FATAL ERROR: {e}")
        print("💡 Suggestions:")
        print("   1. Check your internet connection")
        print("   2. Verify HuggingFace model access")
        print("   3. Try running: pip install torch transformers")
        print("   4. Check if you have enough disk space")

# To run: python python_model_api.py