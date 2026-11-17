"""The hooks that tell the game when to run the functions in your island.

A hook is the line starting with `@` that you put just above a function.

    from grape import on_talk
    from vine import say

    @on_talk("greeter")
    def meet_the_greeter():
        yield say("You made it.", who="greeter")

Nothing in your island calls `meet_the_greeter`. The player walks up to the
spot named "greeter" and presses E, and the game calls it. A spot is a named
place somebody marked on the map in MAPVIS. Your function runs again every time
the player presses E there, so it can check a flag and say something different
on a later visit (see `set_flag` in vine.py).

The two rules from vine.py hold here too. A game word only does something with
`yield` in front of it, so every hooked function needs at least one `yield`.
And you never call a hooked function yourself, because the game does that.

The game loads its own copy of this file before it loads your island, and that
copy is the one that runs. The copy in your repo is the same file, so changing
yours changes nothing in the game. Leave this one as it is.
"""

# filled by the decorators as your island is imported, read by the engine the
# moment the import finishes. You never touch this dict.
_handlers = {}

# your island.json, put here by the engine before your island is imported
_manifest = {}


def manifest():
    """Gives back your island.json file as a dict, so you can read your island's id from it.

        programme = manifest()["programme"]

    A dict is a pair of curly brackets holding named values, and you read one
    value out of it by putting its name in square brackets after it, as above.
    Add `manifest` to the top of your island with `from grape import manifest`.
    Reading the id from here means you type it only once, in island.json, so it
    cannot be spelled two different ways. Changing the dict you get back does
    not change your island. This one needs no `yield` in front, because it only
    reads your own file.
    """
    return dict(_manifest)


def _forget():
    """Between loads. An island reloaded is an island whose old handlers are gone."""
    _handlers.clear()
    _manifest.clear()


def _describe(fields):
    _manifest.clear()
    _manifest.update(fields)


def _registered():
    """Every handler key this island claims, which is what the engine is told."""
    return sorted(_handlers.keys())


def _register(key, fn, what):
    # two handlers on one key is a bug that looks like nothing happening, because
    # one of them silently wins. Stop at import instead, naming both functions.
    if key in _handlers:
        raise ValueError(
            "%s is already handled by %s(), so %s() would never run. One handler each."
            % (what, getattr(_handlers[key], "__name__", "?"), getattr(fn, "__name__", "?")))
    _handlers[key] = fn
    return fn


def on_start(fn):
    """Runs your function every time your island's map loads.

        @on_start
        def arriving():
            yield objective("Go talk to the club president.")
            yield guide_to("host")

    It runs again each time the player comes back to the map, so if something
    should only happen once, set a flag the first time and check for that flag
    before doing it (see `set_flag`). Your island can have only one
    `@on_start`, and its function needs at least one `yield` in it.
    """
    return _register("start", fn, "the island's start")


def on_talk(anchor):
    """Runs your function when the player walks up to a spot and presses E.

    `anchor` is the spot's name in quotes, like "host". Use the name the spot
    has in MAPVIS, which can be different from the words the player reads on it.

        @on_talk("host")
        def the_president():
            yield say("Hey, you made it.", who="host")

    If pressing E does nothing, the name here does not match the spot on the
    map. If the spot is a trigger in MAPVIS, the function runs with no E the
    first time the player walks into it after the map loads. Each spot can have
    only one `@on_talk`, and the player cannot walk away until your function
    has finished.
    """
    if not isinstance(anchor, str) or not anchor:
        raise ValueError('on_talk needs the anchor name, as text: @on_talk("greeter")')

    def register(fn):
        return _register("talk:" + anchor, fn, 'the anchor "%s"' % anchor)
    return register
