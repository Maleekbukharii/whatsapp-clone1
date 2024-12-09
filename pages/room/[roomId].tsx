import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import Head from 'next/head';

export default function Room() {
  const router = useRouter();
  const { roomId } = router.query;
  const [peers, setPeers] = useState<{ [key: string]: Peer.Instance }>({});
  const [messages, setMessages] = useState<{ text: string; from: string; isFile?: boolean }[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const socketRef = useRef<SocketIOClient.Socket>();
  const peersRef = useRef<{ [key: string]: Peer.Instance }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!roomId) return;

    socketRef.current = io('/');
    socketRef.current.emit('join-room', roomId);

    socketRef.current.on('user-connected', (userId) => {
      const peer = new Peer({
        initiator: true,
        trickle: false,
      });

      peer.on('signal', (data) => {
        socketRef.current?.emit('offer', { offer: data, to: userId });
      });

      peer.on('data', (data) => {
        const decodedData = new TextDecoder().decode(data);
        try {
          const parsedData = JSON.parse(decodedData);
          if (parsedData.type === 'file') {
            setMessages((prevMessages) => [...prevMessages, { text: `Received file: ${parsedData.name}`, from: userId, isFile: true }]);
          } else {
            setMessages((prevMessages) => [...prevMessages, { text: parsedData.text, from: userId }]);
          }
        } catch {
          setMessages((prevMessages) => [...prevMessages, { text: decodedData, from: userId }]);
        }
      });

      peersRef.current[userId] = peer;
      setPeers((prevPeers) => ({ ...prevPeers, [userId]: peer }));
    });

    socketRef.current.on('offer', ({ offer, from }) => {
      const peer = new Peer({
        initiator: false,
        trickle: false,
      });

      peer.on('signal', (data) => {
        socketRef.current?.emit('answer', { answer: data, to: from });
      });

      peer.on('data', (data) => {
        const decodedData = new TextDecoder().decode(data);
        try {
          const parsedData = JSON.parse(decodedData);
          if (parsedData.type === 'file') {
            setMessages((prevMessages) => [...prevMessages, { text: `Received file: ${parsedData.name}`, from, isFile: true }]);
          } else {
            setMessages((prevMessages) => [...prevMessages, { text: parsedData.text, from }]);
          }
        } catch {
          setMessages((prevMessages) => [...prevMessages, { text: decodedData, from }]);
        }
      });

      peer.signal(offer);
      peersRef.current[from] = peer;
      setPeers((prevPeers) => ({ ...prevPeers, [from]: peer }));
    });

    socketRef.current.on('answer', ({ answer, from }) => {
      peersRef.current[from].signal(answer);
    });

    socketRef.current.on('ice-candidate', ({ candidate, from }) => {
      peersRef.current[from].addIceCandidate(new RTCIceCandidate(candidate));
    });

    return () => {
      socketRef.current?.disconnect();
      Object.values(peersRef.current).forEach((peer) => peer.destroy());
    };
  }, [roomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim()) {
      Object.values(peersRef.current).forEach((peer) => {
        peer.send(JSON.stringify({ type: 'message', text: inputMessage }));
      });
      setMessages((prevMessages) => [...prevMessages, { text: inputMessage, from: 'You' }]);
      setInputMessage('');
    }
  };

  const sendFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileData = event.target?.result;
        if (fileData) {
          Object.values(peersRef.current).forEach((peer) => {
            peer.send(JSON.stringify({ type: 'file', name: file.name, data: fileData }));
          });
          setMessages((prevMessages) => [
            ...prevMessages,
            { text: `Sent file: ${file.name}`, from: 'You', isFile: true },
          ]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <Head>
        <title>WhatsApp Clone - Chat Room</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <header className="bg-green-500 text-white py-4 px-6">
        <h1 className="text-2xl font-bold">Chat Room: {roomId}</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`max-w-xs md:max-w-md lg:max-w-lg xl:max-w-xl p-3 rounded-lg ${
              message.from === 'You'
                ? 'bg-blue-500 text-white ml-auto'
                : 'bg-white text-gray-800'
            }`}
          >
            <p className="font-bold">{message.from}</p>
            <p>{message.text}</p>
            {message.isFile && (
              <p className="text-sm italic mt-1">
                {message.from === 'You' ? 'File sent' : 'File received'}
              </p>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="bg-white border-t border-gray-200 p-4">
        <form onSubmit={sendMessage} className="flex space-x-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type a message"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="bg-green-500 text-white px-6 py-2 rounded-full hover:bg-green-600 transition duration-300 ease-in-out"
          >
            Send
          </button>
          <label className="bg-blue-500 text-white px-6 py-2 rounded-full hover:bg-blue-600 transition duration-300 ease-in-out cursor-pointer">
            <input type="file" className="hidden" onChange={sendFile} />
            File
          </label>
        </form>
      </div>
    </div>
  );
}

