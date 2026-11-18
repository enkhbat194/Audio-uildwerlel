import { doc, setDoc } from 'firebase/firestore';
import { CANONICAL_CURRICULUM_SHA256 } from '../shared/sourceRegistry';
import type { AudioJobReceipt, QaRecord, SourceRow } from '../shared/types';
import { OperationType, auth, db, handleFirestoreError } from './firebaseClient';

export async function persistMetaToFirestore(params: {
  dataset_version: string;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const path = 'factory_meta/config';
  try {
    await setDoc(doc(db, 'factory_meta', 'config'), {
      dataset_version: params.dataset_version,
      canonical_curriculum_sha256: CANONICAL_CURRICULUM_SHA256,
      drive_folder_id: params.drive_folder_id,
      drive_folder_name: params.drive_folder_name,
      ownerUid: uid,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function persistSourceToFirestore(row: SourceRow): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const path = `sources/${row.source_id}`;
  try {
    await setDoc(doc(db, 'sources', row.source_id), {
      ...row,
      publish_allowed: row.source_gate === 'BLOCK_DOMAIN' ? false : row.publish_allowed,
      ownerUid: uid,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function persistJobToFirestore(job: AudioJobReceipt): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const collectionName = job.is_mock ? 'mock_jobs' : 'real_jobs';
  const path = `${collectionName}/${job.source_id}`;
  try {
    await setDoc(doc(db, collectionName, job.source_id), {
      ...job,
      ownerUid: uid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function persistQaToFirestore(qa: QaRecord): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const path = `qa_records/${qa.source_id}`;
  try {
    await setDoc(doc(db, 'qa_records', qa.source_id), {
      ...qa,
      ownerUid: uid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
