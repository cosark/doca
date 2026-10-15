import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { openDatabase } from '@db/connection.js';
import { currentSchemaTables } from '@db/introspection.js';
import { bindPluginStorage, installPluginStorage, removePluginStorage, cleanupPluginDatabases } from '@server/services/plugin-storage.js';
import { pluginDatabaseConfig, pluginDatabases, pluginDatabaseTables } from '@server/services/plugin-databases.js';
import { createHostFileStore } from '@server/services/host-file-store.js';
import { storageRuntime } from '@server/adapters/storage.js';
const config={driver:'sqlite' as const,path:'/data/probe-core.db'};
const db=await openDatabase(config),files=createHostFileStore(storageRuntime());
const schema={version:1 as const,tables:{notes:{columns:{id:{type:'text' as const,nullable:false},text:{type:'text' as const,nullable:false}},primaryKey:['id'],unique:[]}}};
try {
 const services=[];
 for(const id of ['example.left','example.right']) {
  await db.transaction().execute(tx=>installPluginStorage(tx,id,'1'));
  const storage=await bindPluginStorage(db,files,id,'1');services.push(storage);
  await storage.database.defineSchema(schema);
  await storage.database.insert('notes',[{id:'same',text:id}]);
 }
 assert.equal(pluginDatabaseConfig(config,{}).driver,'sqlite');
 assert((await stat('/data/probe-core.db.plugins.db')).isFile());
 assert(!(await currentSchemaTables(db)).some(t=>t.name==='notes'||/^plugin_[a-f0-9]{56}__/.test(t.name)));
 assert.deepEqual(await services[0]!.database.select('notes'),[{id:'same',text:'example.left'}]);
 assert.deepEqual(await services[1]!.database.select('notes'),[{id:'same',text:'example.right'}]);
 let calls=0;
 await assert.rejects(services[0]!.database.transaction(async tx=>{calls++;await tx.insert('notes',[{id:'rollback',text:'no'}]);throw Error('rollback');}));
 assert.equal(calls,1);
 assert.equal((await services[0]!.database.select('notes')).length,1);
 await db.transaction().execute(tx=>removePluginStorage(tx,'example.left'));
 assert.deepEqual(await cleanupPluginDatabases(db),{failed:0});
 assert.deepEqual(await pluginDatabaseTables(await pluginDatabases(db).open('example.left',false)),[]);
 assert.deepEqual(await services[1]!.database.select('notes'),[{id:'same',text:'example.right'}]);
 await assert.rejects(services[0]!.database.select('notes'));
 console.log(JSON.stringify({sharedSQLiteFile:true,automaticNamespaces:true,logicalTableIsolation:true,rollbackOnce:true,uninstallIsolation:true,staleGenerationFenced:true}));
} finally {await db.destroy()}
