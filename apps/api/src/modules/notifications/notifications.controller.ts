import type { Request, Response, NextFunction } from 'express';
import * as service from './notifications.service';
import {
  queryNotificationSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
  pushStatusQuerySchema,
  updatePreferencesSchema,
} from './notifications.schema';
import * as preferences from './preferences.service';
import { webPushKeys } from './push-dispatch.service';
import { Errors } from '../../middleware/error';
import { whatsAppService } from './whatsapp.service';
import { notificationScheduler } from './scheduler.service';
import { SCHEDULED_TASK_IDS } from './scheduler.tasks';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { describeEmailTransport } from './email-transport';

// ==================== NOTIFICATION ====================

export async function getMyNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const query = queryNotificationSchema.parse(req.query);
    const result = await service.getUserNotifications(req.user!.sub, query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * One of the caller's own notifications. Someone else's — an admin's view
 * included — answers 404, as if it did not exist
 * (decisions/siaran-pengumuman.md, 5).
 */
export async function getNotificationById(req: Request, res: Response, next: NextFunction) {
  try {
    const owner = req.user;
    if (!owner) throw Errors.unauthorized();
    const notification = await service.getNotificationById(req.params.id, owner.sub);
    if (!notification) throw Errors.notFound('Notifikasi tidak ditemukan');
    res.json({ success: true, data: notification });
  } catch (error) {
    next(error);
  }
}

export async function markAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    await service.markAsRead(req.params.id, req.user!.sub);
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
}

export async function markAllAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.markAllAsRead(req.user!.sub);
    res.json({ success: true, data: { count: result.count } });
  } catch (error) {
    next(error);
  }
}

export async function deleteNotification(req: Request, res: Response, next: NextFunction) {
  try {
    const owner = req.user;
    if (!owner) throw Errors.unauthorized();
    const { count } = await service.deleteNotification(req.params.id, owner.sub);
    if (count === 0) throw Errors.notFound('Notifikasi tidak ditemukan');
    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
}

// ==================== MOBILE PUSH (FCM) ====================

export async function updateFcmToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.body as { token?: string | null };
    if (token !== null && (typeof token !== 'string' || token.length < 10 || token.length > 4096)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'token must be a string (or null to clear)' },
      });
      return;
    }
    await prisma.user.update({
      where: { id: req.user!.sub },
      data: { fcmToken: token },
    });
    res.json({ success: true, message: token ? 'FCM token registered' : 'FCM token cleared' });
  } catch (error) {
    next(error);
  }
}

// ==================== WEB PUSH (browser) ====================

/**
 * Store the caller's browser push subscription (idempotent on endpoint).
 *
 * One user may hold several rows (phone, laptop), which is why this is a table
 * and not `users.fcm_token`. An endpoint already owned by *another* user is
 * refused by the service rather than reassigned (CWE-639).
 */
export async function subscribePush(req: Request, res: Response, next: NextFunction) {
  try {
    const { subscription } = pushSubscribeSchema.parse(req.body);
    const outcome = await service.subscribePush(
      req.user!.sub,
      subscription,
      req.get('user-agent') ?? null
    );
    res.json({
      success: true,
      message: 'Push subscription registered',
      data: { created: outcome === 'created' },
    });
  } catch (error) {
    next(error);
  }
}

/** Remove the caller's subscription for one endpoint (on unsubscribe/logout). */
export async function unsubscribePush(req: Request, res: Response, next: NextFunction) {
  try {
    const { endpoint } = pushUnsubscribeSchema.parse(req.body);
    await service.unsubscribePush(req.user!.sub, endpoint);
    res.json({ success: true, message: 'Push subscription removed' });
  } catch (error) {
    next(error);
  }
}

/**
 * Whether the caller has a stored row for this endpoint.
 *
 * The client reconciles its live browser subscription against the server on
 * mount: a browser `PushSubscription` can exist while the API has no row for it
 * (a registration that failed after `subscribe()` succeeded), and the settings
 * card must not claim push is active in that state.
 */
export async function getPushStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { endpoint } = pushStatusQuerySchema.parse(req.query);
    const registered = await service.hasPushSubscription(req.user!.sub, endpoint);
    res.set('Cache-Control', 'no-store, private');
    res.json({ success: true, data: { registered } });
  } catch (error) {
    next(error);
  }
}

/**
 * The VAPID public key the browser subscribes with, or null when this server
 * does not send push. Read at run time, so a key installed on an environment
 * reaches the web without rebuilding the web image.
 */
export async function getPushConfig(_req: Request, res: Response, next: NextFunction) {
  try {
    res.set('Cache-Control', 'no-store, private');
    res.json({ success: true, data: { publicKey: webPushKeys()?.publicKey ?? null } });
  } catch (error) {
    next(error);
  }
}

// ==================== PREFERENCES ====================

/** The caller's own preferences (the defaults until they first save). */
export async function getMyPreferences(req: Request, res: Response, next: NextFunction) {
  try {
    // Never a 304: the settings page must read what was just saved.
    res.set('Cache-Control', 'no-store, private');
    res.json({ success: true, data: await preferences.getPreferences(req.user!.sub) });
  } catch (error) {
    next(error);
  }
}

/** Change any subset of the caller's own preferences. */
export async function updateMyPreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const updates = updatePreferencesSchema.parse(req.body);
    const saved = await preferences.updatePreferences(req.user!.sub, updates);
    res.json({ success: true, message: 'Preferensi notifikasi disimpan', data: saved });
  } catch (error) {
    next(error);
  }
}

// ==================== WHATSAPP ====================

const sendWhatsAppSchema = z.object({
  phone: z.string().min(10),
  message: z.string().min(1),
});

export async function sendWhatsApp(req: Request, res: Response, next: NextFunction) {
  try {
    const data = sendWhatsAppSchema.parse(req.body);
    const result = await whatsAppService.sendMessage({
      to: data.phone,
      message: data.message,
      type: 'text',
    });
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
}

export async function getWhatsAppStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const status = await whatsAppService.getProviderStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
}

// ==================== SCHEDULER ====================

const triggerScheduleSchema = z.object({
  task: z.enum(SCHEDULED_TASK_IDS),
});

export async function triggerScheduledTask(req: Request, res: Response, next: NextFunction) {
  try {
    const { task } = triggerScheduleSchema.parse(req.body);

    await notificationScheduler.runTask(task);

    res.json({ success: true, message: `Task ${task} executed` });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /notifications/settings/channels — current external-channel policy.
 */
export async function getChannelPolicy(req: Request, res: Response, next: NextFunction) {
  try {
    const policy = await service.getChannelPolicy();
    res.json({ success: true, data: policy });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /notifications/settings/email-transport — what actually sends the mail.
 *
 * Exists because the settings screen used to *state* the mail configuration
 * from hardcoded strings — noreply@, halo@, smtp.gmail.com:587 — while the
 * server read them from the environment, and showed "Channel Email Aktif"
 * whenever the channel policy was on, even with no transport configured at all.
 * The page now asks rather than asserts.
 */
export async function getEmailTransport(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: describeEmailTransport() });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /notifications/settings/channels — update the policy (SUPER_ADMIN).
 */
export async function updateChannelPolicy(req: Request, res: Response, next: NextFunction) {
  try {
    const { EMAIL, SMS, WHATSAPP } = req.body ?? {};
    for (const [name, v] of Object.entries({ EMAIL, SMS, WHATSAPP })) {
      if (typeof v !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `${name} must be a boolean` },
        });
      }
    }
    await service.updateChannelPolicy({ EMAIL, SMS, WHATSAPP });
    res.json({ success: true, data: { EMAIL, SMS, WHATSAPP } });
  } catch (error) {
    next(error);
  }
}
