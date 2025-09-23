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
    
    # Try to load your new custom model first
    try:
        print("🔄 Loading your new custom meeting summarizer model...")
        model_path = "CodeXRyu/meeting-summarizer-v2"  # Your new model
        
        primary_tokenizer = AutoTokenizer.from_pretrained(model_path)
        primary_model = AutoModelForSeq2SeqLM.from_pretrained(model_path)
        
        # Move to GPU if available
        if torch.cuda.is_available():
            primary_model = primary_model.cuda()
            print("✅ Custom meeting summarizer model loaded on GPU")
        else:
            print("✅ Custom meeting summarizer model loaded on CPU")
        
        model_info["primary_loaded"] = True
        model_info["current_model"] = "CodeXRyu/meeting-summarizer-v2 (fine-tuned T5)"
        
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

def generate_summary_primary(text, max_length=256, context=None, summary_type="comprehensive"):
    """Generate enhanced summary using your custom fine-tuned model"""
    try:
        # Enhanced prompting for better, longer summaries
        prompts = {
            "comprehensive": f"Provide a detailed comprehensive summary of this meeting including all key topics, decisions made, action items assigned, participant contributions, and important outcomes: {text}",
            "detailed": f"Create a thorough and detailed summary covering all important aspects of this meeting: {text}",
            "action_focused": f"Summarize this meeting with special focus on action items, decisions, deadlines, and responsibilities: {text}",
            "standard": f"summarize: {text}"
        }
        
        # Use enhanced prompt
        if context:
            input_text = f"{prompts[summary_type]} Meeting Context: {context}"
        else:
            input_text = prompts[summary_type]
        
        # Tokenize input with longer max length
        inputs = primary_tokenizer(
            input_text,
            max_length=512,  # Increased from 256 to handle longer meetings
            truncation=True,
            return_tensors="pt"
        )
        
        # Move to same device as model
        if torch.cuda.is_available() and primary_model.device.type == 'cuda':
            inputs = {k: v.cuda() for k, v in inputs.items()}
        
        # Generate summary with enhanced parameters for longer, better summaries
        with torch.no_grad():
            summary_ids = primary_model.generate(
                inputs["input_ids"],
                attention_mask=inputs.get("attention_mask"),
                max_length=max_length,  # Now defaults to 256 instead of 64
                min_length=max(50, max_length // 4),  # Ensure minimum length
                num_beams=6,  # Increased from 4 for better quality
                length_penalty=1.2,  # Reduced to encourage longer summaries
                early_stopping=True,
                do_sample=False,
                no_repeat_ngram_size=3,  # Avoid repetition
                repetition_penalty=1.1  # Additional repetition control
            )
        
        # Decode summary
        summary = primary_tokenizer.decode(summary_ids[0], skip_special_tokens=True)
        return summary
        
    except Exception as e:
        print(f"Error in generate_summary_primary: {e}")
        raise e

def generate_summary_fallback(text, max_length=256, context=None):
    """Generate enhanced summary using fallback model"""
    try:
        # Prepare input text with enhanced prompting
        if context:
            input_text = f"Create a comprehensive meeting summary covering key decisions, action items, and outcomes. Meeting Context: {context}\n\nTranscript: {text}"
        else:
            input_text = f"Create a detailed summary of this meeting covering all important topics, decisions, and action items: {text}"
        
        # Use fallback pipeline with enhanced parameters
        result = fallback_summarizer(
            input_text,
            max_length=min(max_length, 512),  # Allow longer summaries
            min_length=max(60, max_length // 4),  # Ensure substantial minimum length
            do_sample=False,
            num_beams=6,  # Increased for better quality
            length_penalty=1.0,  # Neutral length penalty
            early_stopping=True,
            repetition_penalty=1.1
        )
        
        return result[0]['summary_text']
        
    except Exception as e:
        print(f"Error in generate_summary_fallback: {e}")
        raise e

def generate_summary(text, max_length=256, context=None, summary_type="comprehensive"):
    """Main summary function with automatic fallback and enhanced length"""
    # Try primary model first
    if model_info["primary_loaded"]:
        try:
            print("🤖 Using custom fine-tuned meeting summarizer model...")
            return generate_summary_primary(text, max_length, context, summary_type)
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
        "models_info": model_info,
        "model_repository": "CodeXRyu/meeting-summarizer-v2",
        "enhanced_features": ["longer_summaries", "better_prompting", "action_item_extraction"]
    })

@app.route('/summarize', methods=['POST'])
def summarize():
    """Enhanced summarization endpoint with longer, better summaries"""
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400
        
        text = data['text']
        context = data.get('context', None)
        max_length = data.get('max_length', 256)  # Increased default from 128
        summary_type = data.get('summary_type', 'comprehensive')  # New parameter
        
        if len(text.strip()) < 10:
            return jsonify({'error': 'Text too short for summarization'}), 400
        
        # Generate enhanced summary
        summary = generate_summary(text, max_length, context, summary_type)
        
        return jsonify({
            'summary': summary,
            'input_length': len(text),
            'summary_length': len(summary),
            'model_used': model_info["current_model"],
            'primary_model_loaded': model_info["primary_loaded"],
            'fallback_used': not model_info["primary_loaded"],
            'summary_type': summary_type,
            'max_length_requested': max_length
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/batch_summarize', methods=['POST'])
def batch_summarize():
    """Enhanced batch summarization endpoint"""
    try:
        data = request.get_json()
        
        if not data or 'texts' not in data:
            return jsonify({'error': 'No texts provided'}), 400
        
        texts = data['texts']
        context = data.get('context', None)
        max_length = data.get('max_length', 256)  # Increased default
        summary_type = data.get('summary_type', 'comprehensive')
        
        if not isinstance(texts, list):
            return jsonify({'error': 'texts must be a list'}), 400
        
        results = []
        for i, text in enumerate(texts):
            try:
                if len(text.strip()) < 10:
                    results.append({'error': 'Text too short', 'summary': None})
                else:
                    summary = generate_summary(text, max_length, context, summary_type)
                    results.append({
                        'summary': summary, 
                        'summary_length': len(summary),
                        'error': None,
                        'model_used': model_info["current_model"]
                    })
            except Exception as e:
                results.append({'error': str(e), 'summary': None})
        
        return jsonify({
            'results': results,
            'total_processed': len(texts),
            'primary_model_loaded': model_info["primary_loaded"],
            'model_used': model_info["current_model"],
            'summary_type': summary_type,
            'max_length_requested': max_length
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/summarize_detailed', methods=['POST'])
def summarize_detailed():
    """New endpoint specifically for very detailed, comprehensive summaries"""
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400
        
        text = data['text']
        context = data.get('context', None)
        
        if len(text.strip()) < 10:
            return jsonify({'error': 'Text too short for summarization'}), 400
        
        # Generate multiple types of summaries
        summaries = {}
        summary_types = ['comprehensive', 'detailed', 'action_focused']
        
        for stype in summary_types:
            try:
                summary = generate_summary(text, 384, context, stype)  # Even longer summaries
                summaries[stype] = {
                    'summary': summary,
                    'length': len(summary)
                }
            except Exception as e:
                summaries[stype] = {
                    'summary': None,
                    'error': str(e),
                    'length': 0
                }
        
        return jsonify({
            'summaries': summaries,
            'input_length': len(text),
            'model_used': model_info["current_model"],
            'primary_model_loaded': model_info["primary_loaded"],
            'total_summary_types': len(summary_types)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting Enhanced Python Model API for Meeting Summarization...")
    try:
        load_models()
        print(f"✅ Enhanced Python API ready with meeting-summarizer-v2!")
        print(f"📊 Model Status:")
        print(f"   - Primary (Fine-tuned): {'✅ Loaded' if model_info['primary_loaded'] else '❌ Failed'}")
        print(f"   - Fallback: {'✅ Loaded' if model_info['fallback_loaded'] else '❌ Failed'}")
        print(f"   - Current Model: {model_info['current_model']}")
        print(f"   - Device: {'GPU' if torch.cuda.is_available() else 'CPU'}")
        print(f"   - Model Repository: CodeXRyu/meeting-summarizer-v2")
        print(f"🚀 Enhanced Features:")
        print(f"   - Longer summaries (256+ tokens)")
        print(f"   - Better prompting strategies")
        print(f"   - Multiple summary types")
        print(f"   - Action item extraction")
        print(f"   - Detailed endpoint for comprehensive summaries")
        
        if not model_info['primary_loaded'] and not model_info['fallback_loaded']:
            print("❌ CRITICAL: No models loaded! API will not work properly.")
        
        app.run(host='0.0.0.0', port=5001, debug=False)
    except Exception as e:
        print(f"❌ FATAL ERROR: {e}")
        print("💡 Suggestions:")
        print("   1. Check if CodeXRyu/meeting-summarizer-v2 exists on HuggingFace")
        print("   2. Verify your internet connection")
        print("   3. Try running: pip install torch transformers flask flask-cors")
        print("   4. Check if you have enough disk space")

# To run: python python_model_api.py