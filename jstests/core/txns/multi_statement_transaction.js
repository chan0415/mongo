// Test basic multi-statement transaction.
// @tags: [uses_transactions]
(function() {
    "use strict";
    load('jstests/libs/uuid_util.js');

    const dbName = "test";
    const collName = "multi_statement_transaction";
    const testDB = db.getSiblingDB(dbName);
    const testColl = testDB[collName];

    testColl.drop();

    assert.commandWorked(
        testDB.createCollection(testColl.getName(), {writeConcern: {w: "majority"}}));
    let txnNumber = 0;

    const sessionOptions = {causalConsistency: false};
    const session = db.getMongo().startSession(sessionOptions);
    const sessionDb = session.getDatabase(dbName);

    jsTest.log("Insert two documents in a transaction");

    assert.commandWorked(testColl.remove({}, {writeConcern: {w: "majority"}}));
    // Insert a doc within the transaction.
    assert.commandWorked(sessionDb.runCommand({
        insert: collName,
        documents: [{_id: "insert-1"}],
        readConcern: {level: "snapshot"},
        txnNumber: NumberLong(txnNumber),
        // Only the first write in a transaction has autocommit flag.
        autocommit: false
    }));

    // Cannot read with default read concern.
    assert.eq(null, testColl.findOne({_id: "insert-1"}));
    // But read in the same transaction returns the doc.
    let res = sessionDb.runCommand(
        {find: collName, filter: {_id: "insert-1"}, txnNumber: NumberLong(txnNumber)});
    assert.commandWorked(res);
    assert.docEq([{_id: "insert-1"}], res.cursor.firstBatch);

    // Insert a doc within a transaction.
    assert.commandWorked(sessionDb.runCommand({
        insert: collName,
        documents: [{_id: "insert-2"}],
        txnNumber: NumberLong(txnNumber),
    }));

    // Cannot read with default read concern.
    assert.eq(null, testColl.findOne({_id: "insert-1"}));
    // Cannot read with default read concern.
    assert.eq(null, testColl.findOne({_id: "insert-2"}));

    assert.commandWorked(sessionDb.runCommand({
        commitTransaction: 1,
        txnNumber: NumberLong(txnNumber),
    }));

    // Read with default read concern sees the committed transaction.
    assert.eq({_id: "insert-1"}, testColl.findOne({_id: "insert-1"}));
    assert.eq({_id: "insert-2"}, testColl.findOne({_id: "insert-2"}));

    // Oplog has the "applyOps" entry that includes two insert ops.
    const insertOps = [
        {op: 'i', ns: testColl.getFullName(), o: {_id: "insert-1"}},
        {op: 'i', ns: testColl.getFullName(), o: {_id: "insert-2"}},
    ];

    jsTest.log("Update documents in a transaction");

    testColl.remove({}, {writeConcern: {w: "majority"}});
    // Insert the docs to be updated.
    assert.commandWorked(sessionDb[collName].insert(
        [{_id: "update-1", a: 0}, {_id: "update-2", a: 0}], {writeConcern: {w: "majority"}}));
    // Update the docs in a new transaction.
    txnNumber++;
    assert.commandWorked(sessionDb.runCommand({
        update: collName,
        updates: [{q: {_id: "update-1"}, u: {$inc: {a: 1}}}],
        readConcern: {level: "snapshot"},
        txnNumber: NumberLong(txnNumber),
        // Only the first write in a transaction has autocommmit flag.
        autocommit: false
    }));
    // Batch update in transaction.
    assert.commandWorked(sessionDb.runCommand({
        update: collName,
        updates:
            [{q: {_id: "update-1"}, u: {$inc: {a: 1}}}, {q: {_id: "update-2"}, u: {$inc: {a: 1}}}],
        txnNumber: NumberLong(txnNumber),
    }));
    // Cannot read with default read concern.
    assert.eq({_id: "update-1", a: 0}, testColl.findOne({_id: "update-1"}));
    assert.eq({_id: "update-2", a: 0}, testColl.findOne({_id: "update-2"}));

    assert.commandWorked(sessionDb.runCommand({
        commitTransaction: 1,
        txnNumber: NumberLong(txnNumber),
    }));
    // Read with default read concern sees the commmitted transaction.
    assert.eq({_id: "update-1", a: 2}, testColl.findOne({_id: "update-1"}));
    assert.eq({_id: "update-2", a: 1}, testColl.findOne({_id: "update-2"}));

    // Oplog has the "applyOps" entry that includes two update ops.
    const updateOps = [
        {op: 'u', ns: testColl.getFullName(), o: {$v: 1, $set: {a: 1}}, o2: {_id: "update-1"}},
        {op: 'u', ns: testColl.getFullName(), o: {$v: 1, $set: {a: 2}}, o2: {_id: "update-1"}},
        {op: 'u', ns: testColl.getFullName(), o: {$v: 1, $set: {a: 1}}, o2: {_id: "update-2"}},
    ];

    jsTest.log("Insert, update and read documents in a transaction");

    testColl.remove({}, {writeConcern: {w: "majority"}});
    txnNumber++;
    assert.commandWorked(sessionDb.runCommand({
        insert: collName,
        documents: [{_id: "doc-1"}, {_id: "doc-2"}],
        readConcern: {level: "snapshot"},
        txnNumber: NumberLong(txnNumber),
        // Only the first write in a transaction has autocommit flag.
        autocommit: false
    }));

    // Update the two docs in transaction.
    assert.commandWorked(sessionDb.runCommand({
        update: collName,
        updates: [{q: {_id: "doc-1"}, u: {$inc: {a: 1}}}],
        txnNumber: NumberLong(txnNumber),
    }));
    assert.commandWorked(sessionDb.runCommand({
        update: collName,
        updates: [{q: {_id: "doc-2"}, u: {$inc: {a: 1}}}],
        txnNumber: NumberLong(txnNumber),
    }));
    // Cannot read with default read concern.
    assert.eq(null, testColl.findOne({_id: "doc-1"}));
    assert.eq(null, testColl.findOne({_id: "doc-2"}));

    // But read in the same transaction returns the docs.
    res = sessionDb.runCommand({
        find: collName,
        filter: {$or: [{_id: "doc-1"}, {_id: "doc-2"}]},
        txnNumber: NumberLong(txnNumber)
    });
    assert.commandWorked(res);
    assert.docEq([{_id: "doc-1", a: 1}, {_id: "doc-2", a: 1}], res.cursor.firstBatch);

    assert.commandWorked(sessionDb.runCommand({
        commitTransaction: 1,
        txnNumber: NumberLong(txnNumber),
    }));
    // Read with default read concern sees the commmitted transaction.
    assert.eq({_id: "doc-1", a: 1}, testColl.findOne({_id: "doc-1"}));
    assert.eq({_id: "doc-2", a: 1}, testColl.findOne({_id: "doc-2"}));

    // Oplog has the "applyOps" entry that includes two update ops.
    const insertUpdateOps = [
        {op: 'i', ns: testColl.getFullName(), o: {_id: "doc-1"}},
        {op: 'i', ns: testColl.getFullName(), o: {_id: "doc-2"}},
        {op: 'u', ns: testColl.getFullName(), o: {$v: 1, $set: {a: 1}}, o2: {_id: "doc-1"}},
        {op: 'u', ns: testColl.getFullName(), o: {$v: 1, $set: {a: 1}}, o2: {_id: "doc-2"}},
    ];

    jsTest.log("Insert and delete documents in a transaction");

    testColl.remove({}, {writeConcern: {w: "majority"}});
    testColl.insert([{_id: "doc-1"}, {_id: "doc-2"}], {writeConcern: {w: "majority"}});
    txnNumber++;
    assert.commandWorked(sessionDb.runCommand({
        insert: collName,
        documents: [{_id: "doc-3"}],
        readConcern: {level: "snapshot"},
        txnNumber: NumberLong(txnNumber),
        // Only the first write in a transaction has autocommit flag.
        autocommit: false
    }));

    // Remove three docs in transaction.
    assert.commandWorked(sessionDb.runCommand({
        delete: collName,
        deletes: [{q: {_id: "doc-1"}, limit: 1}],
        txnNumber: NumberLong(txnNumber),
    }));
    // Batch delete.
    assert.commandWorked(sessionDb.runCommand({
        delete: collName,
        deletes: [{q: {_id: "doc-2"}, limit: 1}, {q: {_id: "doc-3"}, limit: 1}],
        txnNumber: NumberLong(txnNumber),
    }));
    // Cannot read the new doc and still see the to-be removed docs with default read concern.
    assert.eq({_id: "doc-1"}, testColl.findOne({_id: "doc-1"}));
    assert.eq({_id: "doc-2"}, testColl.findOne({_id: "doc-2"}));
    assert.eq(null, testColl.findOne({_id: "doc-3"}));

    // But read in the same transaction sees the docs get deleted.
    res = sessionDb.runCommand({
        find: collName,
        filter: {$or: [{_id: "doc-1"}, {_id: "doc-2"}, {_id: "doc-3"}]},
        txnNumber: NumberLong(txnNumber)
    });
    assert.commandWorked(res);
    assert.docEq([], res.cursor.firstBatch);

    assert.commandWorked(sessionDb.runCommand({
        commitTransaction: 1,
        txnNumber: NumberLong(txnNumber),
    }));
    // Read with default read concern sees the commmitted transaction.
    assert.eq(null, testColl.findOne({_id: "doc-1"}));
    assert.eq(null, testColl.findOne({_id: "doc-2"}));
    assert.eq(null, testColl.findOne({_id: "doc-3"}));

    session.endSession();
}());
