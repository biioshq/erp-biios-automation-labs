"use server";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Notification } from "@/server/models";
import { getCurrentUser } from "@/server/auth/session";
import { iso } from "@/server/serialize";

export type NotificationDTO = {
  id: string;
  type: string;
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
};

/** Latest notifications for the signed-in user (personal and team-wide). */
export async function getNotifications(): Promise<{ items: NotificationDTO[]; unread: number }> {
  const user = await getCurrentUser();
  if (!user) return { items: [], unread: 0 };
  await connectDB();
  const me = new Types.ObjectId(user.id);
  const scope = { $or: [{ user: null }, { user: me }] };
  const [docs, unread] = await Promise.all([
    Notification.find(scope).sort({ createdAt: -1 }).limit(30).lean(),
    Notification.countDocuments({ ...scope, readBy: { $ne: me } }),
  ]);
  return {
    unread,
    items: docs.map((n) => ({
      id: String(n._id),
      type: n.type,
      severity: (n.severity ?? "info") as NotificationDTO["severity"],
      title: n.title,
      body: n.body ?? null,
      href: n.href ?? null,
      read: (n.readBy ?? []).some((id) => String(id) === user.id),
      createdAt: iso(n.createdAt as Date)!,
    })),
  };
}

export async function markNotificationRead(id: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(id)) return;
  await connectDB();
  await Notification.updateOne({ _id: id }, { $addToSet: { readBy: new Types.ObjectId(user.id) } });
}

export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  if (!user) return;
  await connectDB();
  const me = new Types.ObjectId(user.id);
  await Notification.updateMany({ $or: [{ user: null }, { user: me }], readBy: { $ne: me } }, { $addToSet: { readBy: me } });
}
