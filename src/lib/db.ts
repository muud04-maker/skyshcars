import mysql from 'mysql2/promise';
let pool:any;
export function db(){if(!pool)pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,waitForConnections:true,connectionLimit:8,queueLimit:0,charset:'utf8mb4'});return pool}
export async function rows<T=any>(sql:string,args:any[]=[]):Promise<T[]>{const [r]=await db().execute(sql,args);return r as T[]}
export async function one<T=any>(sql:string,args:any[]=[]):Promise<T|null>{const r=await rows<T>(sql,args);return r[0]||null}
export async function ping(){await db().query('SELECT 1');return true}
