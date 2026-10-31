// Outbound email: sign-in / reset codes and invite links. Sent over SMTP
// (nodemailer), or — for development and tests — logged to the console and/or
// appended to a capture file. Mail is always off in desktop mode.
import fs from 'node:fs'
import nodemailer from 'nodemailer'
import { APP_NAME, DESKTOP, INVITE_DAYS, MAIL_CAPTURE_FILE, MAIL_FROM, MAIL_LOG_CODES, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_SECURE, SMTP_USER } from './config.js'
import { HttpError } from './auth.js'

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const shell = (body) => `<div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.5;">${body}</div>`

export function mailEnabled() {
  if (DESKTOP) return false
  if (SMTP_HOST) return true
  if (MAIL_LOG_CODES) return true
  return false
}

let transport = null
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  }
  return transport
}

function capture(mail) {
  if (!MAIL_CAPTURE_FILE) return
  const line = { to: mail.to, subject: mail.subject, text: mail.text }
  if (mail.code) line.code = mail.code
  try {
    fs.appendFileSync(MAIL_CAPTURE_FILE, JSON.stringify(line) + '\n')
  } catch (e) {
    console.error('[mail] capture failed:', e.message)
  }
}

export async function sendMail(mail) {
  capture(mail)
  if (!SMTP_HOST) {
    console.log(`[mail] to ${mail.to}\n  subject: ${mail.subject}\n  ${mail.text.replace(/\n/g, '\n  ')}`)
    return
  }
  try {
    await getTransport().sendMail({ from: MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html })
  } catch (e) {
    console.error('[mail] send failed:', e.message)
    throw new HttpError(502, 'Couldn’t send the email. Try again in a minute.')
  }
}

export function codeMail(code, purpose) {
  const reset = purpose === 'reset'
  const subject = reset ? `Reset your ${APP_NAME} password` : `Your ${APP_NAME} code: ${code}`
  const intro = reset ? `Use this code to reset your ${APP_NAME} password:` : `Use this code to sign in to ${APP_NAME}:`
  const text = `${intro} ${code}\n\nIt expires in 10 minutes. If this wasn’t you, you can ignore this email.`
  const html = shell(
    `<p style="margin: 0 0 16px;">${escapeHtml(intro)}</p>` +
      `<p style="margin: 0 0 16px; font-size: 32px; letter-spacing: 0.25em; font-family: ui-monospace, 'SF Mono', monospace; font-weight: 600; color: #111827;">${code}</p>` +
      `<p style="margin: 0; color: #6b7280; font-size: 13px;">It expires in 10 minutes. If this wasn’t you, you can ignore this email.</p>`
  )
  return { subject, text, html, code }
}

export function inviteMail(url, inviterName) {
  const name = String(inviterName || '').trim() || APP_NAME
  const subject = `${name} invited you to ${APP_NAME}`
  const text = `${name} invited you to ${APP_NAME}. Open this link to create your account:\n\n${url}\n\nThis invite expires in ${INVITE_DAYS} days.`
  const html = shell(
    `<p style="margin: 0 0 16px;">${escapeHtml(name)} invited you to ${escapeHtml(APP_NAME)}.</p>` +
      `<p style="margin: 0 0 16px;"><a href="${escapeHtml(url)}" style="display: inline-block; padding: 10px 18px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">Create your account</a></p>` +
      `<p style="margin: 0; color: #6b7280; font-size: 13px;">This invite expires in ${INVITE_DAYS} days.</p>`
  )
  return { subject, text, html }
}

export function logMail() {
  if (DESKTOP) return console.log('[mail] off')
  if (SMTP_HOST) return console.log(`[mail] smtp ${SMTP_HOST}`)
  if (MAIL_LOG_CODES) return console.log('[mail] logging to console')
  console.log('[mail] off')
}
