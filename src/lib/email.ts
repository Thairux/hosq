import { supabase } from './supabase';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function sendEmail(
  to: string,
  subject: string,
  message: string,
  patientId?: string,
  queueEntryId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to,
          subject,
          message,
          patientId,
          queueEntryId,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errorMessage = [data?.error || 'Failed to send email', data?.details]
        .filter(Boolean)
        .join(' - ');
      return { success: false, error: errorMessage };
    }

    return { success: true };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: 'Network error' };
  }
}

export async function notifyPatientCalled(
  queueEntryId: string,
  stageName: string,
  queueNumber: string
) {
  const { data: queueEntry } = await supabase
    .from('queue_entries')
    .select('patient_id, patients(email, full_name), position_in_queue')
    .eq('id', queueEntryId)
    .maybeSingle();

  if (!queueEntry) return;

  const patient = queueEntry.patients as any;
  if (!patient?.email) return;
  const message = `Hello ${patient.full_name}, your queue number ${queueNumber} is now being called! Please proceed to the ${stageName} counter immediately.`;

  await sendEmail(
    patient.email,
    `HOSQ: Queue ${queueNumber} called`,
    message,
    queueEntry.patient_id,
    queueEntryId
  );
}

export async function notifyPatientStageChange(
  queueEntryId: string,
  stageName: string,
  queueNumber: string
) {
  const { data: queueEntry } = await supabase
    .from('queue_entries')
    .select('patient_id, patients(email, full_name)')
    .eq('id', queueEntryId)
    .maybeSingle();

  if (!queueEntry) return;

  const patient = queueEntry.patients as any;
  if (!patient?.email) return;
  const message = `Hello ${patient.full_name}, your queue number ${queueNumber} has moved to ${stageName}. Please proceed to the counter when called.`;

  await sendEmail(
    patient.email,
    `HOSQ: Queue ${queueNumber} moved to ${stageName}`,
    message,
    queueEntry.patient_id,
    queueEntryId
  );
}

export async function notifyPositionChange(
  queueEntryId: string,
  newPosition: number,
  queueNumber: string,
  stageName: string
) {
  const { data: queueEntry } = await supabase
    .from('queue_entries')
    .select('patient_id, patients(email, full_name)')
    .eq('id', queueEntryId)
    .maybeSingle();

  if (!queueEntry) return;

  const patient = queueEntry.patients as any;
  if (!patient?.email) return;

  let positionText = '';
  if (newPosition === 1) {
    positionText = 'You are NEXT! Be ready.';
  } else if (newPosition === 2) {
    positionText = `You are 2nd in line. Get ready soon.`;
  } else {
    positionText = `Your position: #${newPosition} at ${stageName}`;
  }

  const message = `Hello ${patient.full_name}, queue update for ${queueNumber}: ${positionText}`;

  await sendEmail(
    patient.email,
    `HOSQ: Queue ${queueNumber} update`,
    message,
    queueEntry.patient_id,
    queueEntryId
  );
}
