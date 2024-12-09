import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import io from 'socket.io-client';
import Head from 'next/head';

interface Message {
  id?: string;
  text: string;
  from: string;
  isFile?: boolean;
  isEncrypted?: boolean;
  fileContent?: string;
  timestamp?: number;
}

interface User {
  id: string;
  username: string;
}

interface Room {
  id: string;
  name: string;
}

// Simple encryption function
function encrypt(text: string): string {
  return btoa(text);
}

// Simple decryption function
function decrypt(text: string): string {
  return atob(text);
}

export default function Chat() {
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<{ [key: string]: Message[] }>({});
  const [inputMessage, setInputMessage] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const socketRef = useRef<SocketIOClient.Socket | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.push('/');
      return;
    }

    const user = JSON.parse(storedUser);
    setCurrentUser(user);

    socketRef.current = io('/', {
      query: { userId: user.id, username: user.username },
    });

    socketRef.current.on('user-list', (userList: User[]) => {
      setUsers(userList.filter((u) => u.id !== user.id));
    });

    socketRef.current.on('room-list', (roomList: Room[]) => {
      setRooms(roomList);
    });

    socketRef.current.on('private-message', ({ from, message, isFile, isEncrypted, fileContent, timestamp }) => {
      const decryptedMessage = isEncrypted ? decrypt(message) : message;
      const decryptedFileContent = isFile && fileContent ? decrypt(fileContent) : undefined;
      setMessages((prevMessages) => ({
        ...prevMessages,
        [from]: [
          ...(prevMessages[from] || []),
          { text: decryptedMessage, from, isFile, isEncrypted, fileContent: decryptedFileContent, timestamp },
        ],
      }));
    });

    socketRef.current.on('room-message', ({ roomId, from, message, isFile, isEncrypted, fileContent, timestamp }) => {
      const decryptedMessage = isEncrypted ? decrypt(message) : message;
      const decryptedFileContent = isFile && fileContent ? decrypt(fileContent) : undefined;
      setMessages((prevMessages) => ({
        ...prevMessages,
        [roomId]: [
          ...(prevMessages[roomId] || []),
          { text: decryptedMessage, from, isFile, isEncrypted, fileContent: decryptedFileContent, timestamp },
        ],
      }));
    });

    socketRef.current.on('room-created', (room: Room) => {
      setRooms((prevRooms) => [...prevRooms, room]);
    });

    socketRef.current.on('user-joined-room', ({ roomId, username, timestamp }) => {
      setMessages((prevMessages) => ({
        ...prevMessages,
        [roomId]: [
          ...(prevMessages[roomId] || []),
          { text: `${username} joined the room`, from: 'System', timestamp },
        ],
      }));
    });

    socketRef.current.on('group-message-history', ({ roomId, messages: historyMessages }) => {
      setMessages(prevMessages => ({
        ...prevMessages,
        [roomId]: historyMessages.map(msg => ({
          ...msg,
          text: msg.isEncrypted ? decrypt(msg.message) : msg.message,
          fileContent: msg.isFile && msg.fileContent ? decrypt(msg.fileContent) : undefined
        }))
      }));
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [router]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim()) {
      const encryptedMessage = encrypt(inputMessage);
      const timestamp = Date.now();
      if (selectedUser) {
        socketRef.current?.emit('private-message', {
          to: selectedUser.id,
          message: encryptedMessage,
          isEncrypted: true,
          timestamp
        });
        setMessages((prevMessages) => ({
          ...prevMessages,
          [selectedUser.id]: [
            ...(prevMessages[selectedUser.id] || []),
            { text: inputMessage, from: currentUser?.username || 'You', isEncrypted: true, timestamp },
          ],
        }));
      } else if (selectedRoom) {
        socketRef.current?.emit('room-message', {
          roomId: selectedRoom.id,
          message: encryptedMessage,
          isEncrypted: true,
          timestamp
        });
        // We don't add the message locally for room messages anymore
      }
      setInputMessage('');
    }
  };

  const sendFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (selectedUser || selectedRoom)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileData = event.target?.result as string;
        if (fileData) {
          const encryptedFileName = encrypt(file.name);
          const encryptedFileContent = encrypt(fileData);
          const timestamp = Date.now();
          if (selectedUser) {
            socketRef.current?.emit('private-message', {
              to: selectedUser.id,
              message: encryptedFileName,
              isFile: true,
              isEncrypted: true,
              fileContent: encryptedFileContent,
              timestamp
            });
            setMessages((prevMessages) => ({
              ...prevMessages,
              [selectedUser.id]: [
                ...(prevMessages[selectedUser.id] || []),
                { text: file.name, from: currentUser?.username || 'You', isFile: true, isEncrypted: true, fileContent: fileData, timestamp },
              ],
            }));
          } else if (selectedRoom) {
            socketRef.current?.emit('room-message', {
              roomId: selectedRoom.id,
              message: encryptedFileName,
              isFile: true,
              isEncrypted: true,
              fileContent: encryptedFileContent,
              timestamp
            });
            // We don't add the file message locally for room messages anymore
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const createRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (newRoomName.trim()) {
      socketRef.current?.emit('create-room', { name: newRoomName });
      setNewRoomName('');
    }
  };

  const joinRoom = (room: Room) => {
    socketRef.current?.emit('join-room', { roomId: room.id });
    setSelectedRoom(room);
    setSelectedUser(null);
  };

  const leaveRoom = () => {
    if (selectedRoom) {
      socketRef.current?.emit('leave-room', { roomId: selectedRoom.id });
      setSelectedRoom(null);
      setMessages(prevMessages => {
        const newMessages = { ...prevMessages };
        delete newMessages[selectedRoom.id];
        return newMessages;
      });
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Head>
        <title>Encrypted Chat</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="w-1/4 bg-white border-r overflow-y-auto">
        <h2 className="text-2xl font-bold p-4 border-b">Users</h2>
        <ul>
          {users.map((user) => (
            <li
              key={user.id}
              className={`p-4 cursor-pointer hover:bg-gray-100 ${selectedUser?.id === user.id ? 'bg-gray-200' : ''}`}
              onClick={() => {
                setSelectedUser(user);
                setSelectedRoom(null);
              }}
            >
              {user.username}
            </li>
          ))}
        </ul>
        <h2 className="text-2xl font-bold p-4 border-b border-t">Rooms</h2>
        <ul>
          {rooms.map((room) => (
            <li
              key={room.id}
              className={`p-4 cursor-pointer hover:bg-gray-100 ${selectedRoom?.id === room.id ? 'bg-gray-200' : ''}`}
              onClick={() => joinRoom(room)}
            >
              {room.name}
            </li>
          ))}
        </ul>
        <form onSubmit={createRoom} className="p-4 border-t">
          <input
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder="New room name"
            className="w-full px-3 py-2 border rounded-md"
          />
          <button type="submit" className="mt-2 w-full bg-green-500 text-white py-2 rounded-md hover:bg-green-600">
            Create Room
          </button>
        </form>
      </div>
      <div className="flex-1 flex flex-col">
        {(selectedUser || selectedRoom) ? (
          <>
            <header className="bg-green-500 text-white py-4 px-6">
              <h1 className="text-2xl font-bold">
                {selectedUser ? `Encrypted Chat with ${selectedUser.username}` : `Encrypted Room: ${selectedRoom?.name}`}
              </h1>
              {selectedRoom && (
                <button
                  onClick={leaveRoom}
                  className="mt-2 bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600"
                >
                  Leave Room
                </button>
              )}
            </header>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages[selectedUser?.id || selectedRoom?.id || '']?.map((message, index) => (
                <div
                  key={message.id || index}
                  className={`max-w-xs md:max-w-md lg:max-w-lg xl:max-w-xl p-3 rounded-lg ${
                    message.from === currentUser?.username ? 'bg-blue-500 text-white ml-auto' : 
                    message.from === 'System' ? 'bg-gray-300 text-gray-800' :
                    'bg-white text-gray-800'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium">
                      {message.from !== currentUser?.username && message.from !== 'System' && message.from}
                    </span>
                    {message.timestamp && (
                      <span className="text-xs opacity-75">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <p>{message.text}</p>
                  {message.isFile && (
                    <div className="mt-2">
                      {message.fileContent && message.fileContent.startsWith('data:image') ? (
                        <img src={message.fileContent} alt="Shared file" className="max-w-full h-auto" />
                      ) : (
                        <a
                          href={message.fileContent}
                          download={message.text}
                          className="text-sm underline"
                        >
                          Download file
                        </a>
                      )}
                    </div>
                  )}
                  {message.isEncrypted && (
                    <p className="text-xs text-gray-500 mt-1">
                      🔒 Encrypted
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="bg-white border-t border-gray-200 p-4">
              <form onSubmit={sendMessage} className="flex space-x-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Type a message (will be encrypted)"
                  className="flex-1 px-3 py-2 border rounded-md"
                />
                <button
                  type="submit"
                  className="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
                >
                  Send Encrypted File
                </button>
              </form>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={sendFile}
              />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center flex-1">
            <h2 className="text-2xl font-bold text-gray-400">
              Select a user or room to start encrypted chatting
            </h2>
          </div>
        )}
      </div>
    </div>
  );
}

