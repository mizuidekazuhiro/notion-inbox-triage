export interface Env {
  NOTION_TOKEN: string;
  INBOX_DB_ID: string;
  TASKS_DB_ID: string;
  PROJECTS_DB_ID?: string;
  ACTION_SECRET?: string;
  SHORTCUT_TOKEN?: string;
  BASE_URL?: string;
  MAIL_FROM?: string;
  MAIL_TO?: string;
  INBOX_SOURCE_VALUE?: string;
}
