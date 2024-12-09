import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { username, password } = req.body;
    const usersPath = path.join(process.cwd(), 'users.json');
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    
    const user = users.find((u: any) => u.username === username && u.password === password);
    
    if (user) {
      // Don't send the password to the client
      const { password, ...userWithoutPassword } = user;
      res.status(200).json({ message: 'Login successful', user: userWithoutPassword });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}

