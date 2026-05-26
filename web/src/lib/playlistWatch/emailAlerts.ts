import "server-only";

import nodemailer from "nodemailer";

const DEFAULT_SMTP_USERNAME = "nikhil.auh@gmail.com";
const DEFAULT_FROM = "StreamBase Playlist Watch <nikhil.auh@gmail.com>";

export async function sendPlaylistWatchEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}) {
  const password = (process.env.NOTIFY_SMTP_PASSWORD ?? "").trim();
  if (!password) throw new Error("NOTIFY_SMTP_PASSWORD is not configured");

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: (process.env.NOTIFY_SMTP_USERNAME ?? DEFAULT_SMTP_USERNAME).trim(),
      pass: password,
    },
  });

  await transporter.sendMail({
    from: (process.env.PLAYLIST_WATCH_ALERT_FROM ?? DEFAULT_FROM).trim(),
    to,
    subject,
    text,
  });
}
