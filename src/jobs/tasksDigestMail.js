import { buildTasksDigestData } from "../routes/tasksDigest";

export async function runTasksDigestMail(env) {
  const result = await buildTasksDigestData({
    env,
    baseUrl: env.BASE_URL
  });

  return { ...result, sent: false };
}
