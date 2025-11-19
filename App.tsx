import React, { useState } from 'react';
import { HostScreen } from './components/HostScreen';
import { ClientScreen } from './components/ClientScreen';

const App: React.FC = () => {
  const [mode, setMode] = useState<'welcome' | 'host' | 'client'>('welcome');

  if (mode === 'host') return <HostScreen />;
  if (mode === 'client') return <ClientScreen />;

  return (
    <div className="min-h-screen w-full bg-game-dark flex flex-col items-center justify-center text-white p-4">
       <div className="max-w-2xl w-full bg-game-primary p-10 rounded-3xl shadow-2xl border border-white/5 text-center">
          <h1 className="text-5xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-violet-500">
            NEURAL QUIZ
          </h1>
          <p className="text-gray-400 mb-12 text-lg">Локальная викторина с ИИ</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <button 
                onClick={() => setMode('host')}
                className="group relative p-8 rounded-2xl bg-gradient-to-br from-game-secondary to-game-dark border-2 border-game-accent hover:border-white transition-all hover:-translate-y-2 shadow-lg overflow-hidden"
             >
                <div className="absolute inset-0 bg-game-accent opacity-0 group-hover:opacity-20 transition duration-500"></div>
                <div className="text-4xl mb-4">📺</div>
                <h2 className="text-2xl font-bold mb-2">ЭКРАН (ХОСТ)</h2>
                <p className="text-sm text-gray-400">Запусти это на ПК или Телевизоре</p>
             </button>

             <button 
                onClick={() => setMode('client')}
                className="group relative p-8 rounded-2xl bg-gradient-to-br from-game-secondary to-game-dark border-2 border-game-gold hover:border-white transition-all hover:-translate-y-2 shadow-lg overflow-hidden"
             >
                <div className="absolute inset-0 bg-game-gold opacity-0 group-hover:opacity-20 transition duration-500"></div>
                <div className="text-4xl mb-4">📱</div>
                <h2 className="text-2xl font-bold mb-2">Я ИГРОК</h2>
                <p className="text-sm text-gray-400">Запусти это на телефоне</p>
             </button>
          </div>
          
          <div className="mt-12 text-xs text-gray-500">
             <p>Как тестировать:</p>
             <ul className="mt-2 space-y-1">
               <li>1. Откройте эту страницу на одной вкладке и выберите "ХОСТ"</li>
               <li>2. Откройте эту же страницу в других вкладках и выберите "ИГРОК"</li>
               <li>3. Игроки автоматически подключатся к Хосту через локальный канал связи браузера.</li>
             </ul>
          </div>
       </div>
    </div>
  );
};

export default App;