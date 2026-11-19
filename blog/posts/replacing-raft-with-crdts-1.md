---
title: Replacing Raft with CRDTs, part 1: Raft on a plane
date: 2026-11-19
excerpt: Part 1 of 4. Two people, one typo, two different documents. Why consensus is the wrong tool for typing.
---

# Replacing Raft with CRDTs, part 1: Raft on a plane

This is the first of four posts about building a collaborative text editor that keeps working when the network doesn't. By the end of the series we'll have built Eg-walker, the algorithm published at EuroSys 2025, in about 800 lines of Go.

1. **Raft on a plane** (this post): why consensus is the wrong tool for typing.
2. [Counters and sets](post.html?post=replacing-raft-with-crdts-2): the smallest CRDTs, and why deleting is hard.
3. [Text that doesn't interleave](post.html?post=replacing-raft-with-crdts-3): giving every character a place that never moves.
4. Eg-walker (coming soon): keeping the CRDT around only when you need it.

You don't need to know Raft, CRDTs or Go to follow along. Every snippet is cut from [one Go module](https://github.com/PranavPipariya/crdt-editor) that compiles and passes its tests (Go 1.24), trimmed to the lines that matter. Every number is measured.

## The bug

Two people, Alice and Bob, are editing the same document. The document says `Helo`. That's it. That's the whole document. It's a very early-stage startup.

Alice spots the typo and inserts an `l` at index 3. At the same moment Bob adds a `!` at index 4. Each of them sees their own edit instantly, because nobody tolerates an editor that lags, and then sends it to the other:

- Alice has `Hello`. She receives "insert `!` at 4" and gets `Hell!o`.
- Bob has `Helo!`. He receives "insert `l` at 3" and gets `Hello!`.

Two users, two keystrokes, two different documents. And neither screen shows an error. Try it:

<div class="crdt-demo" data-modes="index" data-preset="helo"></div>

That little disaster is the opening figure of the Eg-walker paper. Over this series I'm going to fix it three times, and then make the fix cheap. The first two fixes are wrong, and each one is wrong in a way that hands you the next idea. This post is the first fix.

## Attempt 1: just make everyone agree

The first instinct, and honestly a respectable one: the problem is that Alice and Bob disagree about the order of events, so appoint someone to decide the order. One leader. Every keystroke goes to the leader, the leader writes it into a log, and everybody applies the log in the same order. That's consensus, and the most popular way to do it is Raft.

If you haven't met Raft, here's all of it you need for this series:

- One node is the **leader**. Every write goes through it.
- A write **commits** once a majority of nodes has stored it: two out of three. Only committed writes show up in the document.
- If the others stop hearing from the leader, they elect a new one. Each election starts a new **term**, numbered 1, 2, 3, so everyone can tell an old leader from the current one.

I used etcd's Raft library (`go.etcd.io/raft/v3`, v3.6.0), the one quietly holding up every Kubernetes cluster. If this library has a bad day, so does half the internet. A keystroke is just a proposal:

```go
// A keystroke is just a proposal. It touches the text only once committed.
func (ed *raftEditor) Type(pos int, ch rune) {
	ed.rn.Propose(utf8.AppendRune(binary.AppendUvarint(nil, uint64(pos)), ch))
}
```

To fake a broken network, the test drops every message to or from an "isolated" node. I typed `H` on the leader, and all three nodes showed `H`. Deterministic, correct, boring in the best possible way.

## Then I got on a plane

In the test, "getting on a plane" means isolating the leader. I type an `i` on it, let the other two nodes carry on and type an `o`, then reconnect everyone. What does every node say at the end? Try it before reading on. Type on whichever node is the leader:

<div class="raft-demo"></div>

Here's the same thing as a test:

```go
c.isolated[oldID] = true
old.Type(1, 'i')
c.run(50) // old.text is still "H": no majority, no commit

next := c.leader(t, oldID)
next.Type(1, 'o')
delete(c.isolated, oldID)
c.run(50) // every node: "Ho"
```

Every node says `Ho`. My `i` isn't merged. It's deleted. Here's the sequence:

1. The isolated leader still believes it's in charge, so it accepts my `i` and writes it to its log.
2. It can't reach a majority, so the entry never commits. My screen stays at `H`. I'm typing, and nothing happens.
3. Meanwhile the two nodes on the ground decide I'm dead, elect a new leader, and accept `o`.
4. I land and reconnect. My old leader sees a higher term and steps down.
5. Its uncommitted log entries lose. etcd prints, with the calm of a bank clerk, `found conflict at index 6 … replace the unstable entries`, and the `i` is gone.

Nothing here is a bug in etcd. This is Raft working exactly as designed.

## The quieter problem

There's a second problem, and it's worse. Go back to Alice and Bob. Raft does make them agree: it puts "`l` at 3" before "`!` at 4" in the log, and every node computes `Hell!o`. Everyone agrees, and everyone is wrong.

Positions typed against an old view still land in the wrong place. To fix that, a Raft editor has to make you wait for each keystroke to commit before you type the next one, or rewrite positions on the server. That second option is called operational transformation, and it's what Google Docs does.

So Raft gave me agreement. What I wanted was keystrokes that survive a flight and land where I typed them. Those turn out to be different things.

## What I actually want

So flip the trade. Stay available, accept writes everywhere, and settle the differences later. Not "it'll sort itself out eventually", but a precise promise. Shapiro, Preguiça, Baquero and Zawirski named it in 2011, in the same paper that named CRDTs (more on those in a second). It's called **strong eventual consistency**:

- **Eventual delivery:** every update that reaches one replica eventually reaches all of them.
- **Strong convergence:** two replicas that have received the same set of updates are in the same state. Immediately. No voting, no second round.

That second line is the whole game. It means the data structure itself has to make the order of arrival irrelevant.

A data structure that keeps this promise is a **CRDT**, short for conflict-free replicated data type. Every **replica**, meaning every copy of the document (a server, a laptop, a phone; Raft calls them nodes), keeps its own copy and edits it freely. A merge then brings any two copies to the same state. No leader, no vote. The rest of this series is about building them.

## Fin

That's part 1. Raft makes everyone agree, but it can't let a laptop on a plane keep typing, and it doesn't put a keystroke where its author meant it.

Doing that for text sounded too hard to attempt head-on, so I made the problem smaller. Next time: a counter and a set, the smallest data structures that never need anyone to agree.

[Part 2: Counters and sets](post.html?post=replacing-raft-with-crdts-2)

## Appendix: why you can't just tune Raft

My next thought was: fine, I'll tune the timeouts or something. You can't, and it isn't etcd's fault. Two results, from 1985 and 2002, say no.

- **FLP** (Fischer, Lynch and Paterson, 1985). In an asynchronous network where even one node might crash, no deterministic protocol can guarantee that agreement is ever reached. Raft stays safe by refusing to decide without a majority, and it makes progress only when timing behaves. On a plane, timing does not behave.
- **CAP** (Brewer's conjecture in 2000, proved by Gilbert and Lynch in 2002). While the network is split, a system can't be both available and linearizable. Raft picks linearizable, so the smaller side stops taking writes.

A laptop on a flight is a minority of one, for six hours. For an editor, "wait for a majority" just means "no typing offline".
