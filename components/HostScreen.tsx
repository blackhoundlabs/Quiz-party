import React, { useEffect, useState, useRef } from 'react';
import { GameState, GamePhase, Player, NetworkMessage, MessageType, Question, CHANNEL_NAME } from '../types';
import { generateCategories, generateQuestions } from '../services/geminiService';
import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer } from 'recharts';

const INITIAL_STATE: GameState = {
  phase: GamePhase.LOBBY,
  players: [],
  currentLevel: 1,
  totalLevels: 4,
  currentQuestionIndex: 0,
  currentQuestion: null,
  availableCategories: [],
  timeRemaining: 0,
  loading: false,
  loadingMessage: '',
};

const QUESTION_TIME = 8; // Changed to 8 seconds as requested
const BLITZ_QUESTION_COUNT = 12;
const LEVEL_QUESTION_COUNT = 8;

export const HostScreen: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [questionsQueue, setQuestionsQueue] = useState<Question[]>([]);
  
  // Refs for accessing latest data inside event listeners and timeouts
  const gameStateRef = useRef(gameState);
  const questionsQueueRef = useRef(questionsQueue);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    questionsQueueRef.current = questionsQueue;
  }, [questionsQueue]);

  // --- Networking ---
  
  useEffect(() => {
    console.log("Host: Initializing BroadcastChannel");
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    
    channelRef.current.onmessage = (event) => {
      const msg: NetworkMessage = event.data;
      handleMessage(msg);
    };

    // Periodically broadcast state
    const syncInterval = setInterval(() => {
      broadcastState();
    }, 1000);

    return () => {
      console.log("Host: Closing BroadcastChannel");
      channelRef.current?.close();
      clearInterval(syncInterval);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run ONCE on mount

  const broadcastState = (stateOverride?: GameState) => {
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: MessageType.STATE_UPDATE,
        payload: stateOverride || gameStateRef.current
      });
    }
  };

  const handleMessage = (msg: NetworkMessage) => {
    switch (msg.type) {
      case MessageType.JOIN:
        addPlayer(msg.payload);
        break;
      case MessageType.VOTE_CATEGORY:
        handleCategoryVote(msg.senderId!, msg.payload.category);
        break;
      case MessageType.SUBMIT_ANSWER:
        handleAnswerSubmit(msg.senderId!, msg.payload.answerIndex);
        break;
      case MessageType.REQUEST_STATE:
        broadcastState();
        break;
    }
  };

  // --- Game Logic Helpers ---

  const addPlayer = (newPlayer: Player) => {
    setGameState(prev => {
      if (prev.players.find(p => p.id === newPlayer.id)) {
        // If player exists, just re-broadcast to confirm join
        broadcastState(prev);
        return prev;
      }
      const updated = { ...prev, players: [...prev.players, newPlayer] };
      // Broadcast immediately so the client gets a response fast
      broadcastState(updated);
      return updated;
    });
  };

  const handleCategoryVote = (playerId: string, category: string) => {
    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, selectedCategory: category, lastActionTime: Date.now() } : p
      );
      return { ...prev, players: updatedPlayers };
    });
  };

  const handleAnswerSubmit = (playerId: string, answerIndex: number) => {
    // Validate phase using Ref to be safe, though setGameState handles it safely usually
    if (gameStateRef.current.phase !== GamePhase.QUESTION) return;

    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, currentAnswer: answerIndex, lastActionTime: Date.now() } : p
      );
      return { ...prev, players: updatedPlayers };
    });
  };

  // --- Phase Management ---

  const startGame = async () => {
    setGameState(prev => ({ ...prev, phase: GamePhase.CATEGORY_SELECTION, loading: true, loadingMessage: 'Генерация категорий...' }));
    const categories = await generateCategories(gameStateRef.current.currentLevel);
    setGameState(prev => ({ 
      ...prev, 
      phase: GamePhase.CATEGORY_SELECTION, 
      availableCategories: categories, 
      loading: false, 
      timeRemaining: 10 
    }));
    startTimer(10, resolveCategoryVote);
  };

  const startTimer = (seconds: number, callback: () => void) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setGameState(prev => ({ ...prev, timeRemaining: seconds }));
    
    timerRef.current = setInterval(() => {
      setGameState(prev => {
        if (prev.timeRemaining <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setTimeout(callback, 0);
          return { ...prev, timeRemaining: 0 };
        }
        return { ...prev, timeRemaining: prev.timeRemaining - 1 };
      });
    }, 1000);
  };

  const resolveCategoryVote = async () => {
    const currentPlayers = gameStateRef.current.players;
    const currentCategories = gameStateRef.current.availableCategories;

    const votes: Record<string, number> = {};
    const firstVotes: Record<string, number> = {};

    currentPlayers.forEach(p => {
      if (p.selectedCategory) {
        votes[p.selectedCategory] = (votes[p.selectedCategory] || 0) + 1;
        if (!firstVotes[p.selectedCategory] || p.lastActionTime < firstVotes[p.selectedCategory]) {
           firstVotes[p.selectedCategory] = p.lastActionTime;
        }
      }
    });

    let winner = currentCategories[0];
    let maxVotes = -1;

    if (Object.keys(votes).length === 0) {
        winner = currentCategories[Math.floor(Math.random() * currentCategories.length)];
    } else {
        Object.entries(votes).forEach(([cat, count]) => {
            if (count > maxVotes) {
                maxVotes = count;
                winner = cat;
            } else if (count === maxVotes) {
                if (firstVotes[cat] < firstVotes[winner]) {
                    winner = cat;
                }
            }
        });
    }

    setGameState(prev => ({ ...prev, loading: true, loadingMessage: `Выбрана тема: ${winner}. Генерируем вопросы...` }));
    
    const questions = await generateQuestions(winner, LEVEL_QUESTION_COUNT, false);
    setQuestionsQueue(questions);
    
    // Explicitly start the first question
    startQuestionRound(questions[0], 0);
  };

  // Modified to accept question directly to avoid async state issues
  const startQuestionRound = (question: Question, index: number) => {
    setGameState(prev => ({
      ...prev,
      loading: false,
      phase: GamePhase.QUESTION,
      currentQuestionIndex: index,
      currentQuestion: question,
      timeRemaining: QUESTION_TIME,
      players: prev.players.map(p => ({ ...p, currentAnswer: undefined, roundScore: 0 }))
    }));

    startTimer(QUESTION_TIME, revealAnswers);
  };

  const revealAnswers = () => {
    setGameState(prev => {
        const currentQ = prev.currentQuestion;
        if (!currentQ) return prev;

        const updatedPlayers = prev.players.map(p => {
            let turnPoints = 0;
            if (p.currentAnswer === currentQ.correctIndex) {
                turnPoints = 15; 
            }
            return { ...p, score: p.score + turnPoints, roundScore: turnPoints };
        });

        return { ...prev, phase: GamePhase.ANSWERS_REVEAL, players: updatedPlayers };
    });

    setTimeout(() => {
        setGameState(prev => ({ ...prev, phase: GamePhase.ROUND_RESULT }));
        setTimeout(nextTurn, 5000);
    }, 4000);
  };

  const nextTurn = () => {
    const currentIdx = gameStateRef.current.currentQuestionIndex;
    const queue = questionsQueueRef.current;
    const nextIdx = currentIdx + 1;

    if (nextIdx >= queue.length) {
        setGameState(prev => ({ ...prev, phase: GamePhase.LEVEL_COMPLETE }));
    } else {
        // Atomic update to ensure flow continues
        const nextQ = queue[nextIdx];
        startQuestionRound(nextQ, nextIdx);
    }
  };

  const handleLevelComplete = async () => {
      if (gameStateRef.current.currentLevel >= gameStateRef.current.totalLevels) {
           // Start Blitz
           if (gameStateRef.current.currentLevel === 5) { 
               endGame();
               return;
           }
           
           setGameState(prev => ({ ...prev, loading: true, loadingMessage: 'Финал! БЛИЦ!', phase: GamePhase.LEVEL_INTRO }));
           const blitzQuestions = await generateQuestions('Mix', BLITZ_QUESTION_COUNT, true);
           setQuestionsQueue(blitzQuestions);
           // Start Blitz logic
           setGameState(prev => ({ ...prev, currentLevel: 5 }));
           startQuestionRound(blitzQuestions[0], 0);
      } else {
          // Next Level
          setGameState(prev => ({ ...prev, currentLevel: prev.currentLevel + 1 }));
          startGame(); // Go back to category selection
      }
  };

  const endGame = () => {
      setGameState(prev => {
        const sorted = [...prev.players].sort((a, b) => b.score - a.score);
        return { ...prev, phase: GamePhase.GAME_OVER, winnerId: sorted[0]?.id };
      });
  };

  // Watch ONLY for phase changes to trigger Level Complete logic
  useEffect(() => {
      if (gameState.phase === GamePhase.LEVEL_COMPLETE) {
          setTimeout(handleLevelComplete, 5000);
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.phase]);

  // --- Renders ---

  if (gameState.loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-game-dark text-white flex-col gap-4">
         <div className="animate-spin h-16 w-16 border-4 border-game-accent border-t-transparent rounded-full"></div>
         <h2 className="text-2xl font-bold animate-pulse">{gameState.loadingMessage}</h2>
      </div>
    );
  }

  if (gameState.phase === GamePhase.LOBBY) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-game-primary relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
        <h1 className="text-6xl font-black mb-8 tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-game-accent to-game-gold">
          NEURAL QUIZ
        </h1>
        <div className="p-8 bg-game-secondary/50 backdrop-blur-md rounded-xl border border-white/10 shadow-2xl w-2/3 max-w-4xl">
          <h2 className="text-2xl text-center mb-6 font-bold">Игроки в лобби: {gameState.players.length}</h2>
          <div className="flex flex-wrap gap-6 justify-center min-h-[200px]">
            {gameState.players.map(p => (
              <div key={p.id} className="flex flex-col items-center animate-bounce-short">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-pink-500 to-violet-500 flex items-center justify-center text-4xl shadow-lg mb-2">
                  {p.avatar}
                </div>
                <span className="font-bold text-xl">{p.name}</span>
              </div>
            ))}
            {gameState.players.length === 0 && (
              <p className="text-white/50 text-lg animate-pulse">Ожидание подключения игроков...</p>
            )}
          </div>
        </div>
        <div className="mt-12 flex gap-4">
           <div className="bg-black/40 p-4 rounded text-sm max-w-md text-center">
             <p>Для теста: Откройте эту страницу в новой вкладке и выберите "Я ИГРОК". Убедитесь, что URL в адресной строке совпадает.</p>
           </div>
        </div>
        <button 
          onClick={startGame}
          disabled={gameState.players.length === 0}
          className="mt-8 px-12 py-4 bg-game-accent hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-2xl rounded-full shadow-[0_0_20px_rgba(233,69,96,0.5)] transition transform hover:scale-105"
        >
          НАЧАТЬ ИГРУ
        </button>
      </div>
    );
  }

  if (gameState.phase === GamePhase.CATEGORY_SELECTION) {
    const data = gameState.availableCategories.map(cat => ({
        name: cat,
        votes: gameState.players.filter(p => p.selectedCategory === cat).length
    }));

    return (
      <div className="h-screen w-full flex flex-col items-center p-10 bg-game-dark">
        <h2 className="text-4xl font-bold mb-4 text-game-gold">ВЫБОР ТЕМЫ</h2>
        <div className="text-6xl font-black mb-8">{gameState.timeRemaining}</div>
        
        <div className="w-full max-w-5xl flex-1">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={200} tick={{fill: 'white', fontSize: 20}} />
                    <Bar dataKey="votes" fill="#e94560" radius={[0, 10, 10, 0]}>
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={['#e94560', '#0f3460', '#ffd700', '#16213e'][index % 4]} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-4 gap-4 w-full max-w-6xl mt-8">
            {gameState.players.map(p => (
                <div key={p.id} className={`p-2 rounded text-center ${p.selectedCategory ? 'bg-green-600' : 'bg-gray-700'}`}>
                    {p.name}
                </div>
            ))}
        </div>
      </div>
    );
  }

  if (gameState.phase === GamePhase.QUESTION || gameState.phase === GamePhase.ANSWERS_REVEAL || gameState.phase === GamePhase.ROUND_RESULT) {
    const q = gameState.currentQuestion!;
    const isRevealing = gameState.phase !== GamePhase.QUESTION;

    return (
      <div className="h-screen w-full flex flex-col p-8 bg-game-primary items-center">
         <div className="w-full flex justify-between items-center mb-8">
             <span className="text-2xl text-white/60">Уровень {gameState.currentLevel} • Вопрос {gameState.currentQuestionIndex + 1}</span>
             <div className={`text-5xl font-black ${gameState.timeRemaining < 4 ? 'text-red-500 animate-pulse-fast' : 'text-white'}`}>
                 {gameState.timeRemaining}
             </div>
         </div>

         <div className="bg-white text-game-dark p-10 rounded-2xl shadow-2xl w-full max-w-5xl min-h-[200px] flex items-center justify-center mb-10 transform transition-all">
             <h2 className="text-3xl md:text-5xl font-bold text-center leading-tight">{q.text}</h2>
         </div>

         {/* Host only shows options during REVEAL or RESULT, otherwise hides them */}
         <div className="grid grid-cols-2 gap-6 w-full max-w-5xl flex-1">
             {isRevealing && q.options.map((opt, idx) => {
                 let bgClass = "bg-game-secondary border-2 border-white/10";
                 if (idx === q.correctIndex) bgClass = "bg-green-500 border-green-300 scale-105 shadow-lg";
                 else if (gameState.phase === GamePhase.ROUND_RESULT) bgClass = "opacity-30";

                 return (
                     <div key={idx} className={`rounded-xl p-6 flex items-center justify-center text-2xl font-bold transition-all duration-500 ${bgClass}`}>
                         {opt}
                         {idx === q.correctIndex && <span className="ml-4 text-3xl">✓</span>}
                     </div>
                 );
             })}
             
             {!isRevealing && (
                 <div className="col-span-2 flex items-center justify-center h-full text-white/20 text-2xl animate-pulse">
                     Смотрите варианты ответов на своих устройствах
                 </div>
             )}
         </div>

         {gameState.phase === GamePhase.ROUND_RESULT && (
            <div className="absolute bottom-10 w-full max-w-6xl">
                <div className="bg-black/80 backdrop-blur p-6 rounded-t-2xl border-t border-game-accent">
                    <h3 className="text-xl font-bold mb-4 text-game-gold">Лидеры раунда</h3>
                    <div className="flex gap-4 overflow-x-auto pb-2">
                        {gameState.players.sort((a,b) => b.score - a.score).map((p, i) => (
                            <div key={p.id} className="flex-shrink-0 flex flex-col items-center w-24">
                                <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center text-2xl mb-2 border-2 border-white">
                                    {p.avatar}
                                </div>
                                <span className="font-bold truncate w-full text-center text-sm">{p.name}</span>
                                <span className="text-game-accent font-black">{p.score}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
         )}
      </div>
    );
  }

  if (gameState.phase === GamePhase.GAME_OVER) {
      const winner = gameState.players.find(p => p.id === gameState.winnerId);
      return (
          <div className="h-screen w-full flex flex-col items-center justify-center bg-gradient-to-b from-game-primary to-black">
              <h1 className="text-6xl font-black text-game-gold mb-8 animate-bounce">ПОБЕДИТЕЛЬ!</h1>
              <div className="w-64 h-64 rounded-full bg-white text-9xl flex items-center justify-center shadow-[0_0_100px_rgba(255,215,0,0.6)] mb-8">
                  {winner?.avatar}
              </div>
              <h2 className="text-5xl font-bold mb-4">{winner?.name}</h2>
              <p className="text-3xl text-white/60">{winner?.score} очков</p>
              
              <button onClick={() => window.location.reload()} className="mt-12 px-8 py-3 bg-white text-game-dark font-bold rounded hover:bg-gray-200">
                  Играть снова
              </button>
          </div>
      )
  }

  return <div>Загрузка...</div>;
};