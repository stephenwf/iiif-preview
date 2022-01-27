import { handler } from '../src/sandbox';
import fixture from './fixture/manifest.json';
import fixtureP3 from './fixture/manifest-p3.json';

describe('handle', () => {
  test('handle GET', async () => {
    const result = await handler(new Request('http://localhost/', { method: 'GET' }));
    expect(result.status).toEqual(200);
    const text = await result.text();
    expect(text).toEqual('IIIF Preview');
  });

  test('Creating IIIF', async () => {
    const createResult = await handler(
      new Request('http://localhost/store', { method: 'POST', body: JSON.stringify(fixture) })
    );

    expect(createResult.status).toEqual(201);

    const { location, deleteLocation, updateLocation } = await createResult.json();

    expect(location).toBeDefined();
    expect(deleteLocation).toBeDefined();
    expect(updateLocation).toBeDefined();

    // Get.
    const getResult = await handler(new Request(location, { method: 'GET' }));
    const getBody = await getResult.json();

    expect(getBody).toEqual(fixtureP3);

    // Update.
    const updateResult = await handler(
      new Request(updateLocation, {
        method: 'PUT',
        body: JSON.stringify({
          ...fixtureP3,
          label: { en: ['My custom label'] },
        }),
      })
    );

    expect(updateResult.status).toEqual(200);

    const updatedGetResult = await handler(new Request(location, { method: 'GET' }));
    const updatedGetBody: any = await updatedGetResult.json();

    expect(updatedGetBody.label).toEqual({ en: ['My custom label'] });

    const deleteResult = await handler(new Request(deleteLocation, { method: 'DELETE' }));

    expect(deleteResult.status).toEqual(200);

    await expect(() => handler(new Request(location, { method: 'GET' }))).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Invariant failed: Item not found"`
    );
  });
});
