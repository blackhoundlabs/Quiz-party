import React, { useEffect, useState, useRef } from 'react';
import { GamePhase, GameState, MessageType, NetworkMessage, Player } from '../types';

const AVATARS = ['🐶', '🐱', '🦊', '🦁', '🐯', '🦄', '🐸', '🦉', '🤖', '👽'];

declare const Peer: any;

export const ClientScreen: React.FC = () => {
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [name, setName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [playerId, setPlayerId] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  
  // PeerJS Refs
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  
  const [isPortrait, setIsPortrait] = useState(false);
  const [waitingTime, setWaitingTime] = useState(0);
  const [showContinue, setShowContinue] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    const checkOrientation = () => {
        setIsPortrait(window.innerHeight > window.innerWidth);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    return () => window.removeEventListener('resize', checkOrientation);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (connected && !gameState) {
        timer = setInterval(() => setWaitingTime(p => p + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [connected, gameState]);

  useEffect(() => {
      if (!gameState) return;
      if (gameState.phase === GamePhase.ANSWERS_REVEAL) {
          setShowContinue(false);
          const t = setTimeout(() => setShowContinue(true), 3000);
          return () => clearTimeout(t);
      } else if (gameState.phase === GamePhase.QUESTION) {
          setShowContinue(false);
      } else {
          setShowContinue(true);
      }
  }, [gameState?.phase]);

  const joinGame = () => {
    const cleanCode = roomCode.trim().toUpperCase();
    if (!name.trim() || cleanCode.length !== 4) return;
    setConnectionError('');
    
    const id = Math.random().toString(36).substr(2, 9);
    setPlayerId(id);
    
    // Initialize PeerJS
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
        console.log("Client Peer ID:", peer.id);
        const hostPeerId = `nqp-game-${cleanCode}`;
        console.log("Connecting to Host:", hostPeerId);

        const conn = peer.connect(hostPeerId);
        
        conn.on('open', () => {
            console.log("Connected to Host!");
            connRef.current = conn;
            setConnected(true);
            setConnectionError('');
            
            const newPlayer: Player = {
              id,
              name,
              avatar: selectedAvatar,
              score: 0,
              lastActionTime: 0,
              roundScore: 0
            };

            conn.send({
                type: MessageType.JOIN,
                payload: newPlayer
            });
        });

        conn.on('data', (msg: NetworkMessage) => {
             if (msg.type === MessageType.STATE_UPDATE) {
                 setGameState(msg.payload);
             }
        });

        conn.on('close', () => {
            alert("Соединение с хостом потеряно!");
            window.location.reload();
        });

        conn.on('error', (err: any) => {
            console.error("Connection Error", err);
            setConnectionError("Ошибка подключения. Проверьте код.");
        });
        
        // Timeout check if connection fails silently
        setTimeout(() => {
            if (!conn.open) {
                setConnectionError("Не удалось найти комнату. Проверьте код и интернет.");
            }
        }, 5000);
    });

    peer.on('error', (err: any) => {
        console.error("Peer Error", err);
        if (err.type === 'peer-unavailable') {
             setConnectionError(`Комната ${cleanCode} не найдена. Хост онлайн?`);
        } else {
             setConnectionError("Ошибка сети. Попробуйте снова.");
        }
    });
  };

  const sendVote = (category: string) => {
    connRef.current?.send({
        type: MessageType.VOTE_CATEGORY,
        payload: { category },
        senderId: playerId
    });
  };

  const sendAnswer = (index: number) => {
    connRef.current?.send({
        type: MessageType.SUBMIT_ANSWER,
        payload: { answerIndex: index },
        senderId: playerId
    });
  };

  const sendNextStep = () => {
      connRef.current?.send({
          type: MessageType.REQUEST_NEXT_STEP,
          payload: {},
          senderId: playerId
      });
  };

  // --- RENDERING ---

  const containerStyle = isPortrait 
    ? "fixed top-1/2 left-1/2 w-[100vh] h-[100vw] -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center overflow-hidden bg-game-dark text-white flex flex-col"
    : "w-screen h-screen overflow-hidden bg-game-dark text-white flex flex-col";

  if (!connected) {
    return (
      <div className="min-h-screen bg-game-dark p-6 flex flex-col items-center justify-center text-white">
        <h1 className="text-3xl font-black text-game-accent mb-8">JOIN GAME</h1>
        
        <div className="w-full max-w-md space-y-4 mb-6">
            <div>
                <label className="block text-sm text-gray-400 mb-1">Код комнаты (с экрана Хоста)</label>
                <input
                  type="text"
                  placeholder="ABCD"
                  className="w-full p-4 rounded-lg bg-game-secondary border-2 border-game-secondary focus:border-game-gold outline-none text-center text-3xl font-mono uppercase font-bold tracking-widest"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                  maxLength={4}
                />
            </div>
            
            <div>
                 <label className="block text-sm text-gray-400 mb-1">Твое имя</label>
                 <input
                  type="text"
                  placeholder="Имя"
                  className="w-full p-4 rounded-lg bg-game-secondary border-2 border-game-secondary focus:border-game-accent outline-none text-center text-xl font-bold"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={10}
                />
            </div>
        </div>

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
        
        {connectionError && (
            <div className="bg-red-900/50 border border-red-500 text-red-100 p-4 rounded-lg mb-4 text-center animate-pulse">
                <p className="font-bold">{connectionError}</p>
            </div>
        )}

        <button
          onClick={joinGame}
          disabled={!name.trim() || roomCode.length !== 4}
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
            <h2 className="text-xl font-bold mb-2">Подключение...</h2>
            {waitingTime > 5 && (
                <div className="bg-yellow-900/50 p-4 rounded border border-yellow-500 text-sm mt-4">
                    <p>Долгое подключение... Проверьте интернет.</p>
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
            <p className="mt-4 opacity-70 text-center">Ты в игре! Ждем начала.</p>
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

              <div className="grid grid-cols-2 gap-4 flex-1 mb-20 md:mb-0">
                  {gameState.currentQuestion?.options.map((opt, idx) => {
                      let btnClass = "rounded-xl shadow-xl p-4 flex items-center justify-center text-lg md:text-2xl font-bold transition-all leading-tight border-4 ";
                      
                      if (isQuestionPhase) {
                          if (myAnswer === idx) {
                              btnClass += "bg-[#3b82f6] border-white text-white scale-105"; 
                          } else {
                              btnClass += "bg-[#16213e] border-[#303a55] text-white active:scale-95 hover:bg-[#1f2e52]";
                          }
                      } else {
                          if (idx === correctIndex) {
                              btnClass += "bg-green-600 border-green-400 text-white scale-105 shadow-[0_0_20px_rgba(34,197,94,0.6)]";
                          } else if (myAnswer === idx && idx !== correctIndex) {
                              btnClass += "bg-red-600 border-red-400 text-white opacity-100";
                          } else {
                              btnClass += "bg-[#16213e] border-[#303a55] text-white/30 grayscale";
                          }
                      }

                      return (
                        <button
                            key={idx}
                            onClick={() => isQuestionPhase && sendAnswer(idx)}
                            disabled={!isQuestionPhase}
                            className={btnClass}
                        >
                            {opt}
                        </button>
                      )
                  })}
              </div>

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