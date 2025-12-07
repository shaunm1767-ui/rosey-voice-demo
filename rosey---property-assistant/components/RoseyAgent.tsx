import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../utils/audio-utils';
import { CallStatus } from '../types';
import { VoiceVisualizer } from './VoiceVisualizer';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

const ROSEY_SYSTEM_INSTRUCTION = `
You are "Rosey", a South African property call centre voice assistant.

Your voice style:
Warm, confident, conversational, professional, calm.

Your role:
You help customers with:
1. Buying a property
2. Selling a property
3. Getting a free property valuation

Call behaviour:
- You speak like a human call agent.
- Natural pauses. Friendly responses.
- NEVER say you are an AI or mention technology.
- Speak with a South African accent/tone (use polite phrases like "Is it?", "Aweh", "Pleasure", "Sure thing").

Conversation flow:
1. Greet the user politely and ask if they are looking to Buy, Sell, or get a Free Valuation.

IF BUY:
- Ask: Area/Suburb?
- Ask: Property Type (house, townhouse, apartment)?
- Ask: Name?
- Ask: Phone number?

IF SELL:
- Ask: Property Address?
- Ask: Property Type?
- Ask: Name?
- Ask: Phone number?

IF VALUATION:
- Ask: Property Address?
- Ask: Name?
- Ask: Phone number?

Speaking rules:
- Keep sentences short and concise.
- One question at a time.
- Sound supportive.
- Confirm details back to the caller periodically.
- End the call by saying an agent will contact them shortly.
`;

export const RoseyAgent: React.FC = () => {
  const [status, setStatus] = useState<CallStatus>(CallStatus.IDLE);
  const [audioVolume, setAudioVolume] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Refs for audio handling to avoid re-renders
  const nextStartTimeRef = useRef<number>(0);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null); // Type is tricky for the session promise result
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    // Stop all audio sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });
    sourcesRef.current.clear();

    // Close audio contexts
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // Stop microphone stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Stop processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Close session
    if (sessionRef.current) {
      // sessionRef.current.close() might not exist on the promise directly, but on the resolved object
      // We rely on the connection closing from the server side or garbage collection if we drop ref
      // Ideally we would wait for promise resolve and call close, but for simplicity:
      sessionRef.current = null; 
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    setStatus(CallStatus.IDLE);
    setAudioVolume(0);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const updateVolume = () => {
    if (analyserRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      // Normalize to 0-1 range roughly
      setAudioVolume(Math.min(1, average / 128));
    }
    animationFrameRef.current = requestAnimationFrame(updateVolume);
  };

  const startCall = async () => {
    try {
      setErrorMsg(null);
      setStatus(CallStatus.CONNECTING);

      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error("API Key not found in environment.");
      }

      const ai = new GoogleGenAI({ apiKey });

      // Initialize Audio Contexts
      const InputContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const OutputContextClass = window.AudioContext || (window as any).webkitAudioContext;
      
      const inputCtx = new InputContextClass({ sampleRate: 16000 });
      const outputCtx = new OutputContextClass({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime; // Reset timing

      // Get Microphone Access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Setup Input Audio Pipeline
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // Setup Visualizer Analyser (Input)
      const analyser = inputCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      updateVolume();

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);

      // Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            console.log('Session opened');
            setStatus(CallStatus.ACTIVE);
            
            // Connect mic to processor to start streaming data
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              try {
                // Ensure timing is causal
                nextStartTimeRef.current = Math.max(
                    nextStartTimeRef.current, 
                    outputCtx.currentTime
                );

                const audioBytes = decode(base64Audio);
                const audioBuffer = await decodeAudioData(audioBytes, outputCtx, 24000, 1);
                
                const sourceNode = outputCtx.createBufferSource();
                sourceNode.buffer = audioBuffer;
                sourceNode.connect(outputNode);
                
                sourceNode.addEventListener('ended', () => {
                  sourcesRef.current.delete(sourceNode);
                });

                sourceNode.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(sourceNode);
              } catch (err) {
                console.error("Error processing audio message:", err);
              }
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              console.log("Interrupted");
              sourcesRef.current.forEach(node => {
                try { node.stop(); } catch(e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = outputCtx.currentTime;
            }
            
            // Handle Turn Complete (Optional logging)
            if (message.serverContent?.turnComplete) {
              // console.log("Turn complete");
            }
          },
          onclose: () => {
            console.log("Session closed");
            setStatus(CallStatus.ENDED);
          },
          onerror: (e) => {
            console.error("Session error:", e);
            setErrorMsg("Connection error occurred.");
            setStatus(CallStatus.ERROR);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          systemInstruction: ROSEY_SYSTEM_INSTRUCTION,
        }
      });

      sessionRef.current = sessionPromise;

      // Handle sending data inside the processor callback
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createBlob(inputData);
        
        // Only send if we have a valid session promise
        sessionPromise.then(session => {
          try {
            session.sendRealtimeInput({ media: pcmBlob });
          } catch (err) {
            // Ignore send errors if session is closing
          }
        });
      };

    } catch (err: any) {
      console.error("Failed to start call:", err);
      setErrorMsg(err.message || "Failed to access microphone or connect.");
      setStatus(CallStatus.ERROR);
    }
  };

  const endCall = () => {
    if (sessionRef.current) {
        // Attempt to close gracefully if possible, otherwise cleanup handles it
        sessionRef.current.then((session: any) => {
             // There isn't a public close() on the session object in the current SDK types shown, 
             // but usually strictly cleaning up the client-side context is enough.
             // We will rely on cleanup();
        });
    }
    cleanup();
    setStatus(CallStatus.ENDED);
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl overflow-hidden max-w-md w-full mx-auto border border-gray-100">
      
      {/* Header */}
      <div className="bg-rose-600 p-6 text-center">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Rosey</h1>
        <p className="text-rose-100 text-sm mt-1">Property Specialist</p>
      </div>

      {/* Main Visualizer Area */}
      <div className="p-8 flex flex-col items-center justify-center min-h-[300px] bg-gray-50">
        
        {status === CallStatus.IDLE && (
          <div className="text-center text-gray-500">
            <p className="mb-6">Ready to discuss your property needs?</p>
            <p className="text-sm text-gray-400">Buying • Selling • Valuations</p>
          </div>
        )}

        {status === CallStatus.CONNECTING && (
          <div className="flex flex-col items-center animate-pulse">
            <div className="h-4 w-4 bg-rose-500 rounded-full mb-2"></div>
            <p className="text-rose-600 font-medium">Connecting to Rosey...</p>
          </div>
        )}

        {status === CallStatus.ACTIVE && (
          <VoiceVisualizer isActive={true} volume={audioVolume} />
        )}

        {status === CallStatus.ENDED && (
           <div className="text-center">
             <div className="text-gray-800 font-medium mb-2">Call Ended</div>
             <p className="text-gray-500 text-sm">Thank you for chatting with us.</p>
           </div>
        )}

        {status === CallStatus.ERROR && (
           <div className="text-center text-red-500">
             <p className="font-bold">Error</p>
             <p className="text-sm">{errorMsg}</p>
           </div>
        )}

      </div>

      {/* Controls */}
      <div className="p-6 bg-white border-t border-gray-100">
        <div className="flex justify-center space-x-6">
          {(status === CallStatus.IDLE || status === CallStatus.ENDED || status === CallStatus.ERROR) ? (
            <button
              onClick={startCall}
              className="flex items-center justify-center space-x-2 bg-green-500 hover:bg-green-600 text-white font-semibold py-4 px-8 rounded-full shadow-lg transition-transform transform hover:scale-105 active:scale-95 w-full"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <span>Call Rosey</span>
            </button>
          ) : (
            <button
              onClick={endCall}
              className="flex items-center justify-center space-x-2 bg-red-500 hover:bg-red-600 text-white font-semibold py-4 px-8 rounded-full shadow-lg transition-transform transform hover:scale-105 active:scale-95 w-full"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.516l2.257-1.13a1 1 0 00.502-1.21l-1.498-4.493A1 1 0 005.28 3H5z" />
              </svg>
              <span>End Call</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
