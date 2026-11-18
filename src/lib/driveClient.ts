export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

export interface DriveUploadedReceipt {
  name: string;
  drive_file_id: string;
  size: number;
  kind: 'wav' | 'manifest';
}

export async function listDriveImportFiles(accessToken: string): Promise<DriveFileItem[]> {
  const q = encodeURIComponent(
    "trashed=false and (mimeType='application/json' or mimeType='text/csv' or name contains '.json' or name contains '.csv')"
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=30&orderBy=modifiedTime desc&fields=files(id,name,mimeType,size,modifiedTime)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive файл жагсаалт алдаа (${res.status}): ${errText.slice(0, 180)}`);
  }
  const data = (await res.json()) as { files?: DriveFileItem[] };
  return data.files ?? [];
}

export async function downloadDriveFileText(
  accessToken: string,
  fileId: string
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive файл татах алдаа (${res.status}): ${errText.slice(0, 180)}`);
  }
  return res.text();
}

export async function listDriveFolders(accessToken: string): Promise<DriveFileItem[]> {
  const q = encodeURIComponent(
    "trashed=false and mimeType='application/vnd.google-apps.folder'"
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=30&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive хавтас жагсаалт алдаа (${res.status}): ${errText.slice(0, 180)}`);
  }
  const data = (await res.json()) as { files?: DriveFileItem[] };
  return data.files ?? [];
}

export async function createDriveFolder(
  accessToken: string,
  folderName: string
): Promise<DriveFileItem> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Drive хавтас үүсгэх алдаа (${res.status}): ${errText.slice(0, 180)}`);
  }
  return res.json();
}

export async function uploadBytesToDriveFolder(params: {
  accessToken: string;
  folderId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  kind: 'wav' | 'manifest';
}): Promise<DriveUploadedReceipt> {
  const metadata = {
    name: params.filename,
    parents: [params.folderId],
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append(
    'file',
    new Blob([new Uint8Array(params.bytes)], { type: params.mimeType })
  );

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,md5Checksum',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: form,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Drive upload алдаа (${res.status}) [${params.filename}]: ${errText.slice(0, 180)}`);
  }

  const uploaded = (await res.json()) as { id: string; name: string; size?: string };
  if (!uploaded.id) {
    throw new Error(`Drive upload баталгаажаагүй: ${params.filename} ID буцаасангүй.`);
  }

  return {
    name: uploaded.name || params.filename,
    drive_file_id: uploaded.id,
    size: Number(uploaded.size ?? params.bytes.byteLength),
    kind: params.kind,
  };
}
