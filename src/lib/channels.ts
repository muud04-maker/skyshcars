export type Channel="website"|"whatsapp"|"facebook";
export type ConversationMode="ai"|"human"|"paused";
export interface UnifiedMessage{channel:Channel;externalUserId:string;text:string;externalMessageId?:string;receivedAt:string;}
