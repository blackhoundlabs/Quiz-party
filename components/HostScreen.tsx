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
  totalQuestionsInLevel: 8,
  currentQuestion: null,
  availableCategories: [],
  timeRemaining: 0,
  loading: false,
  loadingMessage: '',
};

const QUESTION_TIME = 8;
const BLITZ_QUESTION_COUNT = 12;
const LEVEL_QUESTION_COUNT = 8;
const MAX_PLAYERS = 4;

export const HostScreen: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [questionsQueue, setQuestionsQueue] = useState<Question[]>([]);
  
  // Refs for accessing latest data inside event listeners and timeouts
  const gameStateRef = useRef(gameState);
  const questionsQueueRef = useRef(questionsQueue);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 1. REGISTRY: Store normalized text of used questions to prevent duplicates
  const questionHistoryRef = useRef<Set<string>>(new Set());
  
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
      case MessageType.REQUEST_NEXT_STEP:
        handleNextStepRequest();
        break;
    }
  };

  // --- Game Logic Helpers ---

  const addPlayer = (newPlayer: Player) => {
    setGameState(prev => {
      // Allow reconnecting with same ID
      if (prev.players.find(p => p.id === newPlayer.id)) {
        broadcastState(prev);
        return prev;
      }
      
      // Check Max Players Limit
      if (prev.players.length >= MAX_PLAYERS) {
          console.warn("Lobby is full, rejecting player", newPlayer.name);
          // Ideally send an error message back, but for now we just don't add them.
          // Broadcast current state so they at least receive something (though client might stick on loading)
          broadcastState(prev);
          return prev;
      }

      const updated = { ...prev, players: [...prev.players, newPlayer] };
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
    if (gameStateRef.current.phase !== GamePhase.QUESTION) return;

    setGameState(prev => {
      const updatedPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, currentAnswer: answerIndex, lastActionTime: Date.now() } : p
      );
      return { ...prev, players: updatedPlayers };
    });
  };

  const handleNextStepRequest = () => {
      const currentPhase = gameStateRef.current.phase;
      
      // If showing answer explanation, move to next question OR level complete
      if (currentPhase === GamePhase.ANSWERS_REVEAL) {
          const currentIdx = gameStateRef.current.currentQuestionIndex;
          const queue = questionsQueueRef.current;
          
          if (currentIdx + 1 >= queue.length) {
              // End of level questions
              setGameState(prev => ({ ...prev, phase: GamePhase.LEVEL_COMPLETE }));
          } else {
              // Next question
              nextTurn();
          }
      }
      // If at leaderboard (Level Complete), move to next level setup
      else if (currentPhase === GamePhase.LEVEL_COMPLETE) {
          handleLevelComplete();
      }
  };

  // --- Unique Question Logic ---

  /**
   * Fetches questions from AI, filtering out duplicates found in questionHistoryRef.
   * Retries up to 3 times if duplicates are found to ensure we get the requested count.
   */
  const fetchUniqueQuestions = async (category: string, totalNeeded: number, isBlitz: boolean): Promise<Question[]> => {
    let gatheredQuestions: Question[] = [];
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    while (gatheredQuestions.length < totalNeeded && attempts < MAX_ATTEMPTS) {
      attempts++;
      const neededNow = totalNeeded - gatheredQuestions.length;
      
      // Request slightly more than needed to increase chance of finding uniques immediately
      // But don't request too many to avoid token limits
      const requestCount = Math.max(neededNow, 4);

      console.log(`Fetching questions attempt ${attempts}. Need: ${neededNow}, Requesting: ${requestCount}`);
      
      const rawQuestions = await generateQuestions(category, requestCount, isBlitz);
      
      const newUniqueQuestions = rawQuestions.filter(q => {
        // 2. FILTRATION: Normalize text to lower case & trimmed for comparison
        const key = q.text.trim().toLowerCase();
        
        if (questionHistoryRef.current.has(key)) {
          console.warn("Duplicate question skipped:", q.text);
          return false;
        }
        
        // Add to registry
        questionHistoryRef.current.add(key);
        return true;
      });

      gatheredQuestions = [...gatheredQuestions, ...newUniqueQuestions];
    }

    // If after retries we still don't have enough, we just proceed with what we have
    // or duplicate some from the current batch (very rare edge case)
    return gatheredQuestions.slice(0, totalNeeded);
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
      timeRemaining: 15 
    }));
    startTimer(15, resolveCategoryVote);
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
    
    const count = gameStateRef.current.currentLevel === 5 ? BLITZ_QUESTION_COUNT : LEVEL_QUESTION_COUNT;
    
    // 3. Use the new secure fetch logic instead of direct API call
    const questions = await fetchUniqueQuestions(winner, count, gameStateRef.current.currentLevel === 5);
    
    // Fallback if somehow empty (network catastrophic fail)
    if (questions.length === 0) {
       // Should be handled by service fallback, but just in case
       console.error("Critical: No questions generated");
    }

    setQuestionsQueue(questions);
    setGameState(prev => ({ ...prev, totalQuestionsInLevel: questions.length })); // Update count based on actual result
    
    if (questions.length > 0) {
      startQuestionRound(questions[0], 0);
    }
  };

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
    // Stop any running timers
    if (timerRef.current) clearInterval(timerRef.current);

    setGameState(prev => {
        const currentQ = prev.currentQuestion;
        if (!currentQ) return prev;

        const updatedPlayers = prev.players.map(p => {
            let turnPoints = 0;
            if (p.currentAnswer === currentQ.correctIndex) {
                // Simple scoring: 15 points for correct
                turnPoints = 15; 
            }
            return { ...p, score: p.score + turnPoints, roundScore: turnPoints };
        });

        return { ...prev, phase: GamePhase.ANSWERS_REVEAL, players: updatedPlayers, timeRemaining: 0 };
    });

    // WE DO NOT AUTO ADVANCE HERE ANYMORE. 
    // We wait for REQUEST_NEXT_STEP from clients.
  };

  const nextTurn = () => {
    const currentIdx = gameStateRef.current.currentQuestionIndex;
    const queue = questionsQueueRef.current;
    const nextIdx = currentIdx + 1;

    if (nextIdx >= queue.length) {
        // Should be handled by handleNextStepRequest -> Level Complete
        setGameState(prev => ({ ...prev, phase: GamePhase.LEVEL_COMPLETE }));
    } else {
        const nextQ = queue[nextIdx];
        startQuestionRound(nextQ, nextIdx);
    }
  };

  const handleLevelComplete = async () => {
      if (gameStateRef.current.currentLevel >= gameStateRef.current.totalLevels) {
           // If we just finished level 4, start Blitz (Level 5)
           if (gameStateRef.current.currentLevel === 4) { 
             setGameState(prev => ({ ...prev, currentLevel: 5, loading: true, loadingMessage: 'Финал! БЛИЦ!', phase: GamePhase.LEVEL_INTRO }));
             // Use unique fetch for Blitz too
             const blitzQuestions = await fetchUniqueQuestions('Mix', BLITZ_QUESTION_COUNT, true);
             setQuestionsQueue(blitzQuestions);
             setGameState(prev => ({ ...prev, totalQuestionsInLevel: blitzQuestions.length }));
             if (blitzQuestions.length > 0) {
                startQuestionRound(blitzQuestions[0], 0);
             }
             return;
           }
           // If we finished Level 5 (Blitz), End Game
           if (gameStateRef.current.currentLevel === 5) {
               endGame();
               return;
           }
      }

      // Normal level transition
      setGameState(prev => ({ ...prev, currentLevel: prev.currentLevel + 1 }));
      startGame(); // Go back to category selection
  };

  const endGame = () => {
      setGameState(prev => {
        const sorted = [...prev.players].sort((a, b) => b.score - a.score);
        return { ...prev, phase: GamePhase.GAME_OVER, winnerId: sorted[0]?.id };
      });
  };

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
          <h2 className="text-2xl text-center mb-6 font-bold">Игроки в лобби: {gameState.players.length} / {MAX_PLAYERS}</h2>
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

  if (gameState.phase === GamePhase.QUESTION || gameState.phase === GamePhase.ANSWERS_REVEAL) {
    const q = gameState.currentQuestion!;
    const isRevealing = gameState.phase === GamePhase.ANSWERS_REVEAL;

    return (
      <div className="h-screen w-full flex flex-col p-8 bg-game-primary items-center">
         <div className="w-full flex justify-between items-center mb-4">
             <span className="text-2xl text-white/60">Уровень {gameState.currentLevel} • Вопрос {gameState.currentQuestionIndex + 1} / {gameState.totalQuestionsInLevel}</span>
             {!isRevealing && (
                <div className={`text-5xl font-black ${gameState.timeRemaining < 4 ? 'text-red-500 animate-pulse-fast' : 'text-white'}`}>
                    {gameState.timeRemaining}
                </div>
             )}
         </div>

         {/* Question Card */}
         <div className="bg-white text-game-dark p-10 rounded-2xl shadow-2xl w-full max-w-5xl min-h-[200px] flex items-center justify-center mb-8 transform transition-all">
             <h2 className="text-3xl md:text-5xl font-bold text-center leading-tight">{q.text}</h2>
         </div>

         {/* Host hides options during QUESTION phase now, only question shown */}
         {!isRevealing && (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-4xl font-bold text-white/30 animate-pulse text-center">
                    Смотрите варианты ответов на телефоне<br/>
                    ⏳
                </div>
            </div>
         )}

         {/* Reveal Phase: Show Answer + Fact */}
         {isRevealing && (
             <div className="w-full max-w-5xl flex flex-col items-center animate-fade-in">
                 <div className="w-full p-6 bg-green-600 rounded-xl text-white text-center shadow-[0_0_30px_rgba(34,197,94,0.5)] mb-6">
                     <span className="block text-sm opacity-70 uppercase tracking-widest mb-2">Правильный ответ</span>
                     <h3 className="text-4xl font-black">{q.options[q.correctIndex]}</h3>
                 </div>
                 
                 {q.explanation && (
                     <div className="bg-game-secondary/80 p-6 rounded-xl border-l-4 border-game-gold w-full">
                         <h4 className="text-game-gold font-bold text-xl mb-2">Интересный факт:</h4>
                         <p className="text-xl leading-relaxed">{q.explanation}</p>
                     </div>
                 )}

                 <div className="mt-8 text-white/50 animate-pulse">
                     Ожидание подтверждения от игроков...
                 </div>
             </div>
         )}
      </div>
    );
  }

  if (gameState.phase === GamePhase.LEVEL_COMPLETE) {
      return (
        <div className="h-screen w-full flex flex-col p-8 bg-game-primary items-center">
            <h2 className="text-5xl font-black text-game-gold mb-8 uppercase tracking-widest">
                Уровень {gameState.currentLevel} завершен!
            </h2>
            
            <div className="w-full max-w-4xl bg-game-secondary/50 rounded-2xl p-8 border border-white/10 flex-1 overflow-hidden flex flex-col">
                <h3 className="text-2xl font-bold mb-6 text-center">Таблица лидеров</h3>
                <div className="overflow-y-auto flex-1 space-y-4">
                    {gameState.players.sort((a,b) => b.score - a.score).map((p, i) => (
                        <div key={p.id} className="flex items-center bg-game-dark p-4 rounded-xl border border-white/5">
                            <div className="w-12 h-12 flex items-center justify-center font-black text-2xl text-white/20 mr-4">
                                #{i + 1}
                            </div>
                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-3xl shadow-lg mr-6">
                                {p.avatar}
                            </div>
                            <div className="flex-1">
                                <h4 className="text-2xl font-bold">{p.name}</h4>
                                <div className="text-sm text-white/50">Раунд: +{p.roundScore}</div>
                            </div>
                            <div className="text-4xl font-black text-game-accent">
                                {p.score}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="mt-8 text-white/50 animate-pulse">
                 Игроки должны нажать "Следующий уровень"...
            </div>
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