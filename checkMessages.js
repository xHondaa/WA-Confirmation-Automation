import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function main() {
  // Open the database
  const db = await open({
    filename: './whatsapp.db',
    driver: sqlite3.Database
  });

  // Query all messages
  const messages = await db.all('SELECT * FROM messages ORDER BY id DESC');
  
  console.log('Received Messages:');
  messages.forEach((msg) => {
    console.log(`${msg.timestamp} | ${msg.sender}: ${msg.message}`);
  });

  await db.close();
}

main();
