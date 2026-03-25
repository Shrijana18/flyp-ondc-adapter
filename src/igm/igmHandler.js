const { getDb } = require('../firebase/admin');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

function normalizeIssuePayload(message = {}) {
  const issue = message.issue || {};
  const orderId = issue.order_details?.id || message.order_id || message.ref_id || '';
  const issueId = issue.id || message.issue_id || uuidv4();

  return {
    issueId,
    issue: {
      id: issueId,
      category: issue.category || message.category || 'ITEM',
      sub_category: issue.sub_category || message.sub_category || '',
      complainant_info: issue.complainant_info || {},
      order_details: issue.order_details || (orderId ? { id: orderId } : {}),
      description: issue.description || { short_desc: message.description || 'Issue raised' },
      source: issue.source || {},
      issue_type: issue.issue_type || message.issue_type || 'ISSUE',
    },
  };
}

/**
 * Handle POST /ondc/issue
 * Buyer raises a complaint about an order.
 */
async function handleIssue(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const db = getDb();
    const normalized = normalizeIssuePayload(message);
    const issue = normalized.issue;
    const issueId = normalized.issueId;
    const orderId = issue.order_details?.id;
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('ondcIssues').doc(issueId).set({
      issueId,
      orderId: orderId || null,
      category: issue.category || 'ITEM',
      subCategory: issue.sub_category || '',
      description: issue.description || {},
      issueType: issue.issue_type || 'ISSUE',
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
      source: 'ondc',
      transactionId: context.transaction_id,
      bapId: context.bap_id,
      bapUri: context.bap_uri,
    });

    console.log(`[igm] Issue ${issueId} created for order ${orderId}`);

    const responseContext = buildContext({
      action: 'on_issue',
      domain: context.domain,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      city: context.city,
      country: context.country,
      version: context.core_version,
    });
    responseContext.bap_id = context.bap_id;
    responseContext.bap_uri = context.bap_uri;

    const responseMessage = {
      issue: {
        id: issueId,
        category: issue.category || 'ITEM',
        sub_category: issue.sub_category || '',
        complainant_info: issue.complainant_info || {},
        order_details: issue.order_details || {},
        description: issue.description || {},
        source: issue.source || {},
        expected_response_time: { duration: 'PT1H' },
        expected_resolution_time: { duration: 'P1D' },
        status: 'OPEN',
        issue_type: 'ISSUE',
        issue_actions: {
          respondent_actions: [
            {
              respondent_action: 'PROCESSING',
              short_desc: 'Issue received and being processed',
              updated_at: new Date().toISOString(),
              updated_by: {
                org: { name: 'FLYP NOW' },
                contact: { phone: '', email: 'support@flypnow.in' },
                person: { name: 'Support Team' },
              },
            },
          ],
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };

    await sendCallback(context.bap_uri, 'on_issue', responseContext, responseMessage);
  } catch (err) {
    console.error('[igm] handleIssue error:', err.message);
  }
}

/**
 * Handle POST /ondc/issue_status
 * Buyer polls the status of an existing issue.
 */
async function handleIssueStatus(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const db = getDb();
    const issueId = message.issue_id || message.issue?.id || message.ref_id || uuidv4();
    const requestedStatusRaw = message.status || message.issue_status || message.disposition_status || '';
    const requestedStatus = String(requestedStatusRaw).toUpperCase();

    const issueSnap = await db.collection('ondcIssues').doc(issueId).get();
    const issue = issueSnap.exists
      ? issueSnap.data()
      : {
        issueId,
        status: requestedStatus || 'OPEN',
        category: message.category || message.issue?.category || 'ITEM',
        orderId: message.order_id || message.issue?.order_details?.id || null,
        resolution: message.resolution?.short_desc || message.short_desc || '',
      };

    const effectiveStatus = requestedStatus || issue.status || 'OPEN';

    if (requestedStatus && issueSnap.exists) {
      await db.collection('ondcIssues').doc(issueId).set({
        status: effectiveStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const responseContext = buildContext({
      action: 'on_issue_status',
      domain: context.domain,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      city: context.city,
      country: context.country,
      version: context.core_version,
    });
    responseContext.bap_id = context.bap_id;
    responseContext.bap_uri = context.bap_uri;

    const responseMessage = {
      issue: {
        id: issueId,
        status: effectiveStatus,
        category: issue.category || 'ITEM',
        order_details: { id: issue.orderId },
        issue_actions: {
          respondent_actions: [
            {
              respondent_action: effectiveStatus === 'RESOLVED' || effectiveStatus === 'CLOSED' ? 'RESOLVED' : 'PROCESSING',
              short_desc: issue.resolution || 'Issue is being reviewed',
              updated_at: new Date().toISOString(),
              updated_by: {
                org: { name: 'FLYP NOW' },
                contact: { phone: '', email: 'support@flypnow.in' },
                person: { name: 'Support Team' },
              },
            },
          ],
        },
        resolution_provider: { respondent_info: { type: 'SELLER-SUPPORT', org: { name: 'FLYP NOW' } } },
        resolution: effectiveStatus === 'RESOLVED' || effectiveStatus === 'CLOSED' ? { short_desc: issue.resolution || 'Resolved' } : undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };

    await sendCallback(context.bap_uri, 'on_issue_status', responseContext, responseMessage);
  } catch (err) {
    console.error('[igm] handleIssueStatus error:', err.message);
  }
}

module.exports = { handleIssue, handleIssueStatus };
