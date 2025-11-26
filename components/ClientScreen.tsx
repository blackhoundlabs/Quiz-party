import React, { useEffect, useState, useRef } from 'react';
import { GamePhase, GameState, MessageType, NetworkMessage, Player, CHANNEL_NAME } from '../types';

const AVATARS = ['🐶', '🐱', '🦊', '🦁', '🐯', '🦄', '🐸', '🦉', '🤖', '👽'];

export const ClientScreen: React.FC = () => {
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [playerId, setPlayerId] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  
  // Landscape detection
  const [isPortrait, setIsPortrait] = useState(false);

  // Debug timer to show slow connection
  const [waitingTime, setWaitingTime] = useState(0);
  
  // UI State for Continue Button
  const [showContinue, setShowContinue] = useState(false);

  useEffect(() => {
    // Check orientation
    const checkOrientation = () => {
        setIsPortrait(window.innerHeight > window.innerWidth);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);

    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current.onmessage = (event) => {
      const msg: NetworkMessage = event.data;
      if (msg.type === MessageType.STATE_UPDATE) {
        setGameState(msg.payload);
      }
    };

    // Poll for state independently
    const interval = setInterval(() => {
        if (channelRef.current) {
            channelRef.current.postMessage({ type: MessageType.REQUEST_STATE, payload: null });
        }
    }, 2000);

    return () => {
        clearInterval(interval);
        window.removeEventListener('resize', checkOrientation);
        channelRef.current?.close();
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (connected && !gameState) {
        timer = setInterval(() => setWaitingTime(p => p + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [connected, gameState]);

  // Logic for Delayed Continue Button
  useEffect(() => {
      if (!gameState) return;
      
      if (gameState.phase === GamePhase.ANSWERS_REVEAL) {
          setShowContinue(false);
          const t = setTimeout(() => setShowContinue(true), 3000); // 3 seconds delay
          return () => clearTimeout(t);
      } else if (gameState.phase === GamePhase.QUESTION) {
          setShowContinue(false);
      } else {
          // For other phases like Level Complete, show immediately
          setShowContinue(true);
      }
  }, [gameState?.phase]);

  const joinGame = () => {
    if (!name.trim()) return;
    const id = Math.random().toString(36).substr(2, 9);
    setPlayerId(id);
    const newPlayer: Player = {
      id,
      name,
      avatar: selectedAvatar,
      score: 0,
      lastActionTime: 0,
      roundScore: 0
    };
    
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: MessageType.JOIN,
        payload: newPlayer
      });
      // Also request state immediately
      channelRef.current.postMessage({
        type: MessageType.REQUEST_STATE,
        payload: null
      });
    }
    setConnected(true);
  };

  const sendVote = (category: string) => {
    channelRef.current?.postMessage({
        type: MessageType.VOTE_CATEGORY,
        payload: { category },
        senderId: playerId
    });
  };

  const sendAnswer = (index: number) => {
    channelRef.current?.postMessage({
        type: MessageType.SUBMIT_ANSWER,
        payload: { answerIndex: index },
        senderId: playerId
    });
  };

  const sendNextStep = () => {
      channelRef.current?.postMessage({
          type: MessageType.REQUEST_NEXT_STEP,
          payload: {},
          senderId: playerId
      });
  };

  // --- RENDERING ---

  // Wrapper for Forced Landscape
  // If portrait, we rotate 90 degrees and fix dimensions
  const containerStyle = isPortrait 
    ? "fixed top-1/2 left-1/2 w-[100vh] h-[100vw] -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center overflow-hidden bg-game-dark text-white flex flex-col"
    : "w-screen h-screen overflow-hidden bg-game-dark text-white flex flex-col";

  if (!connected) {
    return (
      <div className="min-h-screen bg-game-dark p-6 flex flex-col items-center justify-center text-white">
        <h1 className="text-3xl font-black text-game-accent mb-8">JOIN GAME</h1>
        <input
          type="text"
          placeholder="Твоё имя"
          className="w-full max-w-md p-4 rounded-lg bg-game-secondary border-2 border-game-secondary focus:border-game-accent outline-none text-center text-xl font-bold mb-6"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={10}
        />
        <div className="grid grid-cols-5 gap-2 mb-8">
          {AVATARS.map(av => (
            <button
              key={av}
              onClick={() => setSelectedAvatar(av)}
              className={`text-3xl p-2 rounded-lg transition ${selectedAvatar === av ? 'bg-game-accent scale-110' : 'bg-game-secondary'}`}
            >
              {av}
            </button>
          ))}
        </div>
        <button
          onClick={joinGame}
          disabled={!name.trim()}
          className="w-full max-w-md bg-white text-game-dark font-black py-4 rounded-lg text-xl disabled:opacity-50"
        >
          ПОЕХАЛИ!
        </button>
      </div>
    );
  }

  if (!gameState) {
      return (
        <div className={containerStyle + " items-center justify-center p-8 text-center"}>
            <div className="animate-spin h-10 w-10 border-4 border-game-accent border-t-transparent rounded-full mb-4"></div>
            <h2 className="text-xl font-bold mb-2">Ожидание хоста...</h2>
            
            {waitingTime > 5 && (
                <div className="bg-red-900/50 p-4 rounded border border-red-500 text-sm mt-4">
                    <p>Проверьте, что вкладка ХОСТ открыта.</p>
                </div>
            )}
        </div>
      );
  }

  const myPlayer = gameState.players.find(p => p.id === playerId);

  if (gameState.phase === GamePhase.LOBBY) {
    return (
        <div className={containerStyle + " items-center justify-center p-8"}>
            <div className="text-6xl mb-4 animate-bounce">{myPlayer?.avatar || selectedAvatar}</div>
            <h2 className="text-2xl font-bold">Привет, {myPlayer?.name || name}!</h2>
            <p className="mt-4 opacity-70 text-center">Ждем начала игры...</p>
        </div>
    );
  }

  if (gameState.phase === GamePhase.CATEGORY_SELECTION) {
      return (
          <div className={containerStyle + " p-4"}>
              <h2 className="text-center text-game-gold font-bold text-xl mb-4">Голосуй за тему!</h2>
              <div className="grid grid-cols-2 gap-4 flex-1">
                  {gameState.availableCategories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => sendVote(cat)}
                        className={`p-4 rounded-xl font-bold text-lg shadow-lg transition-all ${myPlayer?.selectedCategory === cat ? 'bg-game-accent text-white scale-105 border-4 border-white' : 'bg-white text-game-dark'}`}
                      >
                          {cat}
                      </button>
                  ))}
              </div>
          </div>
      )
  }

  if (gameState.phase === GamePhase.QUESTION || gameState.phase === GamePhase.ANSWERS_REVEAL) {
      const isQuestionPhase = gameState.phase === GamePhase.QUESTION;
      const correctIndex = gameState.currentQuestion?.correctIndex;
      const myAnswer = myPlayer?.currentAnswer;

      return (
          <div className={containerStyle + " p-4"}>
              <div className="flex justify-between mb-2 text-white font-mono items-center shrink-0">
                  <span className="font-bold text-lg">Очки: {myPlayer?.score}</span>
                  {isQuestionPhase && <span className="text-2xl animate-pulse">⏳ {gameState.timeRemaining}</span>}
              </div>

              {/* Answers Grid: 2x2 */}
              <div className="grid grid-cols-2 gap-4 flex-1 mb-20 md:mb-0">
                  {gameState.currentQuestion?.options.map((opt, idx) => {
                      let btnClass = "rounded-xl shadow-xl p-4 flex items-center justify-center text-lg md:text-2xl font-bold transition-all leading-tight border-4 ";
                      
                      if (isQuestionPhase) {
                          // --- Question Phase Styling ---
                          if (myAnswer === idx) {
                              // Chosen Answer: Highlighted Blue + White/Gold Border
                              btnClass += "bg-[#3b82f6] border-white text-white scale-105"; 
                          } else {
                              // Default: Dark Blue + Gray Border
                              btnClass += "bg-[#16213e] border-[#303a55] text-white active:scale-95 hover:bg-[#1f2e52]";
                          }
                      } else {
                          // --- Reveal Phase Styling ---
                          if (idx === correctIndex) {
                              // Correct Answer: Green
                              btnClass += "bg-green-600 border-green-400 text-white scale-105 shadow-[0_0_20px_rgba(34,197,94,0.6)]";
                          } else if (myAnswer === idx && idx !== correctIndex) {
                              // Wrongly Chosen: Red
                              btnClass += "bg-red-600 border-red-400 text-white opacity-100";
                          } else {
                              // Others: Faded
                              btnClass += "bg-[#16213e] border-[#303a55] text-white/30 grayscale";
                          }
                      }

                      return (
                        <button
                            key={idx}
                            // ALLOW changing answer by not checking `myAnswer !== undefined` here
                            onClick={() => isQuestionPhase && sendAnswer(idx)}
                            disabled={!isQuestionPhase}
                            className={btnClass}
                        >
                            {opt}
                        </button>
                      )
                  })}
              </div>

              {/* Continue Button (Only visible in Reveal Phase after delay) */}
              {!isQuestionPhase && showContinue && (
                  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-3/4 max-w-md z-50">
                      <button 
                        onClick={sendNextStep}
                        className="w-full py-4 bg-white text-game-dark font-black text-xl rounded-full shadow-[0_0_20px_rgba(255,255,255,0.5)] active:scale-95 transition hover:bg-gray-200"
                      >
                          {gameState.currentQuestionIndex + 1 >= gameState.totalQuestionsInLevel ? "УРОВЕНЬ ПРОЙДЕН 🏆" : "СЛЕДУЮЩИЙ ХОД ➡️"}
                      </button>
                  </div>
              )}
          </div>
      )
  }

  if (gameState.phase === GamePhase.LEVEL_COMPLETE) {
      return (
        <div className={containerStyle + " items-center justify-center p-8 text-center"}>
            <h2 className="text-3xl font-black text-game-gold mb-4">ТАБЛИЦА ЛИДЕРОВ</h2>
            <p className="text-white/60 mb-8">Посмотри результаты на главном экране</p>
            
            {showContinue && (
                <button 
                    onClick={sendNextStep}
                    className="w-3/4 max-w-md py-5 bg-game-accent text-white font-black text-xl rounded-xl shadow-lg animate-pulse"
                >
                    СЛЕДУЮЩИЙ УРОВЕНЬ 🚀
                </button>
            )}
        </div>
      );
  }

  return (
      <div className="h-screen bg-game-dark flex items-center justify-center text-white p-8 text-center">
          <h2 className="text-xl animate-pulse">Смотри на экран хоста...</h2>
      </div>
  );
};