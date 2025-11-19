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
  
  // Debug timer to show slow connection
  const [waitingTime, setWaitingTime] = useState(0);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current.onmessage = (event) => {
      const msg: NetworkMessage = event.data;
      if (msg.type === MessageType.STATE_UPDATE) {
        setGameState(msg.payload);
      }
    };

    // Poll for state independently of joining, to check connectivity or reconnect
    const interval = setInterval(() => {
        if (channelRef.current) {
            channelRef.current.postMessage({ type: MessageType.REQUEST_STATE, payload: null });
        }
    }, 2000);

    return () => {
        clearInterval(interval);
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

  if (!connected) {
    return (
      <div className="min-h-screen bg-game-dark p-6 flex flex-col items-center justify-center text-white">
        <h1 className="text-3xl font-black text-game-accent mb-8">JOIN GAME</h1>
        <input
          type="text"
          placeholder="Твоё имя"
          className="w-full p-4 rounded-lg bg-game-secondary border-2 border-game-secondary focus:border-game-accent outline-none text-center text-xl font-bold mb-6"
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
          className="w-full bg-white text-game-dark font-black py-4 rounded-lg text-xl disabled:opacity-50"
        >
          ПОЕХАЛИ!
        </button>
      </div>
    );
  }

  if (!gameState) {
      return (
        <div className="h-screen flex flex-col items-center justify-center text-white bg-game-dark p-8 text-center">
            <div className="animate-spin h-10 w-10 border-4 border-game-accent border-t-transparent rounded-full mb-4"></div>
            <h2 className="text-xl font-bold mb-2">Ожидание хоста...</h2>
            <p className="text-gray-400 mb-4">Мы пытаемся подключиться к главной игре.</p>
            
            {waitingTime > 5 && (
                <div className="bg-red-900/50 p-4 rounded border border-red-500 text-sm">
                    <p className="font-bold">Не подключается?</p>
                    <p>1. Убедитесь, что вкладка "ХОСТ" открыта и активна.</p>
                    <p>2. Проверьте, что этот сайт открыт по ТОМУ ЖЕ адресу (URL), что и хост.</p>
                </div>
            )}
            
            <button onClick={() => window.location.reload()} className="mt-8 text-sm text-game-accent underline">
                Перезагрузить
            </button>
        </div>
      );
  }

  const myPlayer = gameState.players.find(p => p.id === playerId);

  // --- Phase Renders ---

  if (gameState.phase === GamePhase.LOBBY) {
    return (
        <div className="h-screen bg-game-secondary flex flex-col items-center justify-center text-white p-8">
            <div className="text-6xl mb-4 animate-bounce">{myPlayer?.avatar || selectedAvatar}</div>
            <h2 className="text-2xl font-bold">Привет, {myPlayer?.name || name}!</h2>
            <p className="mt-4 opacity-70 text-center">Смотри на главный экран.</p>
        </div>
    );
  }

  if (gameState.phase === GamePhase.CATEGORY_SELECTION) {
      return (
          <div className="h-screen bg-game-dark p-4 flex flex-col">
              <h2 className="text-center text-game-gold font-bold text-xl mb-4">Голосуй за тему!</h2>
              <div className="grid grid-cols-1 gap-4 flex-1">
                  {gameState.availableCategories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => sendVote(cat)}
                        className={`p-4 rounded-xl font-bold text-lg shadow-lg transition-all ${myPlayer?.selectedCategory === cat ? 'bg-game-accent text-white scale-105 border-2 border-white' : 'bg-white text-game-dark'}`}
                      >
                          {cat}
                      </button>
                  ))}
              </div>
          </div>
      )
  }

  if (gameState.phase === GamePhase.QUESTION) {
      const hasAnswered = myPlayer?.currentAnswer !== undefined;
      return (
          <div className="h-screen bg-game-dark p-4 flex flex-col">
              <div className="flex justify-between mb-4 text-white font-mono">
                  <span>Очки: {myPlayer?.score}</span>
                  <span>⏳ {gameState.timeRemaining}</span>
              </div>
              {hasAnswered ? (
                  <div className="flex-1 flex items-center justify-center text-white text-2xl font-bold animate-pulse">
                      Ответ принят!
                  </div>
              ) : (
                  <div className="grid grid-cols-1 gap-3 flex-1 overflow-y-auto">
                      {gameState.currentQuestion?.options.map((opt, idx) => {
                          const colors = ['bg-red-500', 'bg-blue-500', 'bg-yellow-500', 'bg-green-500'];
                          return (
                            <button
                                key={idx}
                                onClick={() => sendAnswer(idx)}
                                className={`${colors[idx]} rounded-xl shadow-xl p-4 flex items-center justify-center text-xl font-bold text-white hover:opacity-90 active:scale-95 transition leading-tight min-h-[80px]`}
                            >
                                {opt}
                            </button>
                          )
                      })}
                  </div>
              )}
          </div>
      )
  }

  if (gameState.phase === GamePhase.ANSWERS_REVEAL || gameState.phase === GamePhase.ROUND_RESULT) {
      const wasCorrect = myPlayer?.currentAnswer === gameState.currentQuestion?.correctIndex;
      return (
        <div className={`h-screen flex flex-col items-center justify-center p-8 text-white ${wasCorrect ? 'bg-green-600' : 'bg-red-600'}`}>
            <div className="text-8xl mb-6">{wasCorrect ? '😎' : '😱'}</div>
            <h2 className="text-4xl font-black mb-2">{wasCorrect ? 'КРАСАВА!' : 'МИМО!'}</h2>
            {wasCorrect && <p className="text-xl">+15 очков</p>}
            <div className="mt-8 p-4 bg-black/20 rounded text-center">
                <p className="font-bold">Твой счет: {myPlayer?.score}</p>
            </div>
        </div>
      );
  }

  return (
      <div className="h-screen bg-game-dark flex items-center justify-center text-white p-8 text-center">
          <h2 className="text-xl animate-pulse">Смотри на экран хоста...</h2>
      </div>
  );
};