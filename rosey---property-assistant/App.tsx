import React from 'react';
import { RoseyAgent } from './components/RoseyAgent';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <header className="mb-8 text-center">
        <div className="flex items-center justify-center mb-2">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-gray-800 tracking-tight">Skyline Properties</h1>
        <p className="text-gray-500 mt-2">Speak to our virtual agent for assistance</p>
      </header>

      <main className="w-full">
        <RoseyAgent />
      </main>

      <footer className="mt-12 text-center text-gray-400 text-sm">
        <p>&copy; 2024 Skyline Properties. All rights reserved.</p>
        <p className="mt-1 text-xs">Powered by Gemini 2.5 Live API</p>
      </footer>
    </div>
  );
};

export default App;