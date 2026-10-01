import { db, rows } from './db';

export async function ensureAiKnowledgeSchema(){
  await db().execute(`CREATE TABLE IF NOT EXISTS ai_knowledge (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(191) NOT NULL,
    content TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    source VARCHAR(80) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX(active), INDEX(updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

export async function activeKnowledge(limit=50){
  await ensureAiKnowledgeSchema();
  return rows<any>(`SELECT id,title,content FROM ai_knowledge WHERE active=1 ORDER BY updated_at DESC LIMIT ${Math.max(1,Math.min(limit,100))}`);
}
