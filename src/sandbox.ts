import { Vault } from '@hyperion-framework/vault';
import invariant from 'tiny-invariant';
import * as Helpers from './helpers';

const keyLength = 32;
const partLength = keyLength / 2;
const updateKeyLength = 64;
const expirationTtl = 60 * 60 * 24 * 2; // 48-hours

const encryptedEnabled = false; // Does not work on Deployed workers.
const rotatingUpdateKey = true; // Disable to have stable edit links.

export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const base = new URL(request.url);
  base.pathname = '';
  const baseUrl = base.toString();

  if (url.pathname === '/') {
    return new Response('IIIF Preview', { status: 200 });
  }

  if (request.method === 'HEAD') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Accept, Content-Type',
        'Content-Type': 'application/json',
      },
    });
  }

  if (url.pathname === '/store' && request.method === 'POST') {
    const body: any = await request.json();

    invariant(body !== null);
    invariant(body['id'] || body['@id'], 'Invalid or missing Identifier');
    invariant(body['type'] === 'Manifest' || body['@type'] === 'sc:Manifest', 'Resource must be Manifest');

    const id = body.id || body['@id'];
    const vault = new Vault();
    const manifest = await vault.loadManifest(id, body);

    invariant(!!manifest, 'Invalid Manifest');

    const key1 = Helpers.generateId(partLength);
    const key2 = Helpers.generateId(partLength);
    const key3 = Helpers.generateId(updateKeyLength);
    const key4 = Helpers.generateId(updateKeyLength);
    const storeKey = encryptedEnabled ? key1 : key1 + key2;

    const data = vault.toPresentation3(manifest);
    const manifestJson = encryptedEnabled ? await Helpers.encrypt(JSON.stringify(data), key1) : data;

    await IIIFSandbox.put(
      storeKey,
      JSON.stringify({
        update: encryptedEnabled ? await Helpers.encrypt(key2, key3) : key3,
        delete: encryptedEnabled ? await Helpers.encrypt(key2, key4) : key4,
        manifest: manifestJson,
      }),
      {
        expirationTtl, // 48 hours
        metadata: { ttl: Date.now() + expirationTtl * 1000 },
      }
    );

    // POST /store  Body<Manifest> -> Response<{ location: string; updateLocation: string }>
    return new Response(
      JSON.stringify({
        location: `${baseUrl}p3/${key1}${key2}`,
        updateLocation: `${baseUrl}update/${key1}${key2}/${key3}`,
        deleteLocation: `${baseUrl}delete/${key1}${key2}/${key4}`,
        expirationTtl,
      }),
      {
        status: 201,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      }
    );
  }

  if (url.pathname.startsWith('/p3/') && request.method === 'GET') {
    // GET /p3/:id -> Response<Manifest>

    const [, , keys] = url.pathname.split('/');
    const key1 = keys.slice(0, partLength);
    const key2 = keys.slice(partLength);
    const storeKey = encryptedEnabled ? key1 : key1 + key2;

    if (!key1 || !key2) {
      return new Response('Invalid identifier', {
        status: 401,
      });
    }

    const resp = await IIIFSandbox.getWithMetadata<{ ttl: number }>(storeKey);

    invariant(resp && resp.value, 'Item not found');

    const data = JSON.parse(resp.value);

    invariant(data, 'Item not found');

    const manifest = encryptedEnabled ? await Helpers.decrypt(data.manifest, key1) : data.manifest;

    return new Response(encryptedEnabled ? manifest : JSON.stringify(manifest), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'X-Sandbox-Expires-In': `${Math.floor(((resp.metadata?.ttl || 0) - Date.now()) / 1000)}`,
      },
    });
  }

  const isUpdate = url.pathname.startsWith('/update/');
  const isDelete = url.pathname.startsWith('/delete/');

  if (isUpdate || isDelete) {
    const [, , keys, key3] = url.pathname.split('/');
    const key1 = keys.slice(0, partLength);
    const key2 = keys.slice(partLength);
    const storeKey = encryptedEnabled ? key1 : key1 + key2;

    invariant(key1, 'Key not found (1)');
    invariant(key2, 'Key not found (2)');
    invariant(key3, 'Key not found (3)');

    // Validate.

    const json = await IIIFSandbox.get(storeKey);
    invariant(json);

    const obj: any = JSON.parse(json);
    invariant(obj && obj.update && obj.manifest && obj.delete, 'Invalid Object');

    const keyToCompare = isUpdate ? obj.update : obj.delete;
    if (encryptedEnabled) {
      const update = await Helpers.decrypt(keyToCompare, key3);
      invariant(update === key2, 'Invalid update key');
    } else {
      invariant(keyToCompare === key3, 'Invalid update key');
    }

    if (request.method === 'DELETE') {
      // DELETE /edit/:id -> Response<{ location: string; updateLocation: string; }>
      await IIIFSandbox.delete(storeKey);

      return new Response('Deleted', {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (isUpdate && request.method === 'PUT') {
      const body: any = await request.json();
      const id = body.id || body['@id'];
      const vault = new Vault();
      const manifest = await vault.loadManifest(id, body);
      const newKey3 = rotatingUpdateKey ? Helpers.generateId(updateKeyLength) : key3;

      invariant(!!manifest, 'Invalid Manifest');

      const data = vault.toPresentation3(manifest);
      const manifestJson = encryptedEnabled ? await Helpers.encrypt(JSON.stringify(data), key1) : data;

      await IIIFSandbox.put(
        storeKey,
        JSON.stringify({
          update: encryptedEnabled ? await Helpers.encrypt(key2, newKey3) : newKey3,
          delete: obj.delete,
          manifest: manifestJson,
        }),
        {
          expirationTtl,
          metadata: { ttl: Date.now() + expirationTtl },
        }
      );

      // POST /edit/:id -> Response<{ location: string; updateLocation: string; }>
      return new Response(
        JSON.stringify({
          location: `${baseUrl}p3/${key1}${key2}`,
          updateLocation: `${baseUrl}update/${key1}${key2}/${key3}`,
          expirationTtl,
        }),
        {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
        }
      );
    }
  }

  return new Response('Not found', { status: 404 });
}
