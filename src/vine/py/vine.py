"""The game words your island can use, like `say`, `choose` and `guide_to`.

Each word asks the game to do one thing, such as showing a line in the talk box
or moving the camera. Hover over a word in VS Code to see what it does, what to
put in its brackets, and a line you can copy. To use a word, add its name to
the `from vine import` line at the top of your island, like
`from vine import say, task_done`.

A word only does something when it has `yield` in front of it:

    yield say("Welcome to the club.")     # the line shows up
    say("Welcome to the club.")           # nothing happens

You never call your own functions that have a line like `@on_talk("host")`
above them. The game calls them for you when the player does the matching
thing. If you write a helper function of your own that uses these words, run it
with `yield from` in front of it, like `yield from my_tour()`.

A spot is a named place on the map, like "host" or "the_desk", that somebody
marked in MAPVIS. Every word that needs a place on the map takes a spot name.
A few words also take "thor" to mean the player, and their own hover text says
so. A spot name the map does not have stops your island with an error that
points at your line. The one exception is `who` in `say`, where a name the map
does not have is shown just as you typed it.

The game runs its own copy of this file, which is the same as this one, so
changing yours changes nothing in the game. Leave this one as it is.
"""


# ---- talking ---------------------------------------------------------------

def say(text, who=None, portrait=None):
    """Shows one line in the talk box and waits for the player to click.

    `text` is the words to show, in quotes.
    `who` is the spot that is talking, like "host", or "thor" for the player.
    The talk box shows the name the player sees for that spot, and for "thor"
    it shows the name the player picked. A name that is not a spot on the map
    is shown just as you typed it. Leave `who` out for a line with no name.
    `portrait` is a face to show beside the line. The only one drawn so far is
    "principal", and most lines have none.

        yield say("Hey, you made it.", who="host")

    To show a number, turn it into text first, like
    `yield say("You got " + str(score))`.
    """
    intent = {"kind": "say", "text": text}
    # the key is left out entirely rather than sent as None, because the engine's `who` is optional and an explicit null is a different thing from an absent name
    if who is not None:
        intent["who"] = who
    # `portrait` rides the same field the cutscene registry already reads, so the one drawn face is reachable from an island and not only from TypeScript
    if portrait is not None:
        intent["portrait"] = portrait
    return intent


def choose(options, prompt=None):
    """Shows buttons for the player to pick from, and gives back which one they picked.

    `options` is a list of the button words, in square brackets.
    `prompt` is an optional question shown in the talk box, with the buttons
    stacked above the box.

        pick = yield choose(["Pizza", "Tacos"], prompt="Best lunch?")

    `pick` is 0 for the first button, 1 for the second, and so on. Put the list
    first and the question second, or the game stops with an error.
    """
    intent = {"kind": "choose", "options": options}
    if prompt is not None:
        intent["prompt"] = prompt
    return intent


# ---- moving him, and moving the camera -------------------------------------

def guide_to(anchor):
    """Puts an arrow and a trail on the map pointing to a spot, and your next line runs straight away without waiting for the player to get there.

    `anchor` is the spot to point at, like "trophies". Pass None to take the
    arrow down again.

        yield guide_to("trophies")

    Take the arrow down with `yield guide_to(None)` once the player gets there.
    If you leave it up, the game cannot show the player its own arrow to the
    next thing to do.
    """
    # None is the message here, the same as in look_at, so it is sent rather than left out
    return {"kind": "guide_to", "anchor": anchor}


def highlight(anchor, on=True):
    """Lights up one thing on the map where it stands, with no arrow and no trail.

    `anchor` is the spot to light up, like "the_desk". Pass None to turn the
    light off.
    `on` is optional, and `on=False` turns the light off too, the same as
    passing None.

        yield highlight("the_desk")
        yield highlight(None)

    Use it when the player is already close and you only want to show which one
    you mean. When they have to go and find it, use `guide_to`.
    """
    return {"kind": "highlight", "anchor": anchor if on else None, "on": bool(on and anchor)}


def walk_to(anchor, off=None):
    """Takes over the controls and walks the player to a spot, and your next line runs once they get there.

    `anchor` is the spot to walk to, like "the_desk". The player stops where the
    map marks a place to stand for it, facing the way the map says.
    `off` is optional: two numbers like (20, 0) that move the stopping point
    right and down, in pixels of the map. Use a minus number for left or up,
    and keep each one between -96 and 96, like
    `yield walk_to("the_desk", off=(-20, 0))`.

        yield walk_to("the_desk")
    """
    intent = {"kind": "walk_to", "anchor": anchor}
    if off is not None:
        intent["off"] = [off[0], off[1]]
    return intent


def look_at(anchor, ms=None):
    """Moves the camera over to a spot for a short time, then lets it go back to following the player.

    `anchor` is the spot to look at, like "trophies". Pass None to bring the
    camera straight back to the player.
    `ms` is how long the camera stays away from the player, in milliseconds,
    where 1000 is one second. That time includes the move over, so a far spot
    needs a bigger number. Leave it out for half a second. Your next line waits
    until the time is up.

        yield look_at("trophies", ms=1500)
    """
    # None is the message here, so unlike every other optional it is sent rather than left out: an absent anchor would read as no argument, and letting the camera go is a thing an island asks for on purpose
    intent = {"kind": "look_at", "anchor": anchor}
    if ms is not None:
        intent["ms"] = ms
    return intent


# ---- his own body ------------------------------------------------------------

def pose(name=None, facing=None):
    """Makes the player sit, lie down or stand, or turns them to face a direction, without walking.

    `name` is "sit", "sleep" to lie down, or "stand" to get back up.
    `facing` is a direction: "north", "south", "east", "west", "north-east",
    "north-west", "south-east" or "south-west".
    You can give one of them or both.

        yield pose("sleep", facing="south")
        yield pose(facing="west")

    The pose ends as soon as the player walks.
    """
    intent = {"kind": "pose"}
    if name is not None:
        intent["pose"] = name
    if facing is not None:
        intent["facing"] = facing
    return intent


# these words drive a placement by its anchor: taking one over stops its own life, releasing it resumes from where the clock has got to, and `off` steps aside from the station's one authored mark in painting pixels, snapped onto legal floor and refused over ninety-six


def actor_move(actor, to, off=None, facing=None, pace=None):
    """Walks another character over to a spot, and your next line runs once they get there.

    `actor` is the spot that has the character on it, like "host".
    `to` is the spot to walk to, or "thor" to walk up to the player and face
    them.
    `off` is optional: two numbers like (20, 0) that move where they stop right
    and down. Use a minus number for left or up, and keep each one between -96
    and 96.
    `facing` is optional: the direction to face at the end, like "south".
    `pace` is "stroll", "walk" or "run". Leave it out for "walk", which is half
    the player's speed, and even "run" is slower than the player.

        yield actor_move("host", "the_desk", pace="stroll")

    They walk in a straight line, so pick a spot with nothing in the way.
    """
    intent = {"kind": "actor_move", "actor": actor, "to": to}
    if off is not None:
        intent["off"] = [off[0], off[1]]
    if facing is not None:
        intent["facing"] = facing
    if pace is not None:
        intent["pace"] = pace
    return intent


def lead_to(actor, to, off=None, pace=None):
    """Has a character walk ahead to a spot while the player follows behind, like a guided tour.

    `actor` is the spot that has the character on it, like "host".
    `to` is the spot to lead the player to, like "the_desk".
    `off` is optional: two numbers like (20, 0) that move where the character
    stops right and down. Use a minus number for left or up, and keep each one
    between -96 and 96. Leave it out and they stop just beside the spot.
    `pace` is "stroll", "walk" or "run". Leave it out to walk.

        yield lead_to("host", "the_desk")

    Your next line runs once both of them have stopped and turned to face each
    other, so that is the place for the character to speak. The character
    walks around anything in the way.
    """
    intent = {"kind": "lead_to", "actor": actor, "to": to}
    if off is not None:
        intent["off"] = [off[0], off[1]]
    if pace is not None:
        intent["pace"] = pace
    return intent


def place(actor, at, off=None, facing=None):
    """Puts a character at a spot straight away with no walking, to set up a scene before it starts.

    `actor` is the spot that has the character on it, like "host".
    `at` is the spot to put them at, or "thor" to put them right in front of
    the player.
    `off` is optional: two numbers like (20, 0) that move them right and down
    from that spot. Use a minus number for left or up, and keep each one
    between -96 and 96.
    `facing` is optional: a direction like "south". Leave it out and the
    character and the player turn to face each other.

        yield place("host", "thor")

    If the spot is right where the player is standing, the character is put
    beside the player.
    """
    intent = {"kind": "place", "actor": actor, "at": at}
    if off is not None:
        intent["off"] = [off[0], off[1]]
    if facing is not None:
        intent["facing"] = facing
    return intent


def actor_face(actor, facing):
    """Turns a character, or the player, to face something without moving them.

    `actor` is the spot that has the character on it, like "host", or "thor" to
    turn the player.
    `facing` is what to face: "thor" for the player, another spot like
    "the_desk", or a direction like "north".

        yield actor_face("host", "thor")
        yield actor_face("thor", "host")

    The first line turns "host" toward the player, and the second turns the
    player toward "host". The player can only be turned toward a spot, so use
    `yield pose(facing="north")` to point them in a direction. A character
    drawn facing only one way cannot turn. Pointing it at a spot or a direction
    stops the game with an error, and pointing it at "thor" does nothing.
    """
    return {"kind": "actor_face", "actor": actor, "facing": facing}


def actor_look(actor, look):
    """Swaps the picture a character is showing for another picture drawn for it in MAPVIS.

    `actor` is the spot that has the character on it, like "host".
    `look` is the name that picture was given in MAPVIS. "idle" always puts the
    character's normal picture back.

        yield actor_look("host", "idle")
    """
    return {"kind": "actor_look", "actor": actor, "look": look}


def actor_release(actor=None):
    """Lets a character you have been moving go back to doing its own thing.

    `actor` is the spot that has the character on it, like "host". Leave the
    brackets empty to let every character go.

        yield actor_release("host")

    Once your island moves, turns or places a character, it stays the way you
    left it until you let it go or the player leaves the map.
    """
    intent = {"kind": "actor_release"}
    if actor is not None:
        intent["actor"] = actor
    return intent


# ---- following a line somebody drew --------------------------------------------

def route(path, who=None, backwards=False):
    """Sends the player, a character or the ship along a path drawn in MAPVIS, and your next line runs at the end.

    `path` is the name of the path, like "the_long_way".
    `who` is who travels along it. Leave it out for the player, give the spot
    that has a character on it, or write "ship" for the boat.
    `backwards=True` goes from the end of the path to its start, which only
    works on a path drawn as two-way.

        yield route("the_long_way")

    A sailing path only works with `who="ship"`. A walking path that crosses
    ground nobody can stand on stops with an error saying where.
    """
    intent = {"kind": "route", "path": path}
    if who is not None:
        intent["who"] = who
    if backwards:
        intent["backwards"] = True
    return intent


def view(shot, ms=None):
    """Moves the camera to one of five ready-made shots, and your next line runs once it gets there.

    `shot` is one of these:

        "island"   the whole island, held still
        "walk"     the normal camera that follows the player
        "close"    twice as close, still following the player
        "ship"     the normal distance, for watching the boat
        "sail"     as wide as the camera goes, for open water

    `ms` is optional: how long your next line waits once the camera gets there,
    in milliseconds. "island" then goes back to the normal camera. Every other
    shot stays until you pick another one, like `yield view("walk")`, and so
    does "island" when you leave `ms` out.

        yield view("island", ms=3000)
    """
    intent = {"kind": "view", "view": shot}
    if ms is not None:
        intent["ms"] = ms
    return intent


def framing(shot, ms=None):
    """Moves the camera to a shot somebody set up in MAPVIS, and your next line runs once it gets there.

    `shot` is the name of the shot, like "the_screen". Pass None to give the
    camera back to the player.
    `ms` is optional: how long to hold the shot once the camera gets there, in
    milliseconds, before it goes back to the player and your next line runs.
    Leave it out and the shot stays until you write `yield framing(None)`.

        yield framing("the_screen")

    The corner buttons hide while the shot is up.
    """
    intent = {"kind": "framing", "shot": shot}
    if ms is not None:
        intent["ms"] = ms
    return intent


# ---- time ----------------------------------------------------------------------

def wait(ms):
    """Pauses your island for a while before the next line runs.

    `ms` is how long to pause, in milliseconds, where 1000 is one second. The
    longest pause is 30 seconds, so a bigger number is cut down to 30000.

        yield wait(1000)
    """
    return {"kind": "wait", "ms": ms}


def wait_for(anchor, ms=None):
    """Waits until the player walks into a spot, and gives back True if they did.

    `anchor` is the spot to wait for, like "trophies".
    `ms` is the longest to wait, in milliseconds. Leave it out to wait up to two
    minutes.

        got_there = yield wait_for("trophies", ms=10000)

    `got_there` is True if the player reached the spot and False if the time
    ran out. If they are already standing there, it is True straight away. The
    player can walk around while this waits.
    """
    intent = {"kind": "wait_for", "anchor": anchor}
    if ms is not None:
        intent["ms"] = ms
    return intent


# ---- sound ---------------------------------------------------------------------

def sound(name, gain=None):
    """Plays one sound effect once, and your next line runs straight away.

    `name` is the sound: "click", "open", "close", "deny", "page", "mark",
    "chime", "surf_in", "cork_pop", "sail_snap", "bottle" or "board".
    `gain` is optional: how loud, where 1 is normal and 0.5 is half as loud.

        yield sound("chime")

    Sound starts switched off in the game's settings, so a player only hears it
    after turning sound on. There is no music yet.
    """
    intent = {"kind": "sound", "name": name}
    if gain is not None:
        intent["gain"] = gain
    return intent


# ---- the world ---------------------------------------------------------------

def ashore():
    """Moves the player off a boat tied up at the dock and onto the dock.

    A sea trip you wrote with `route` and `who="ship"` ends with the player
    still on the boat, so you can move the camera or say a line first. This is
    the line that lets them off. It does nothing if they are already on land.

        yield ashore()
    """
    return {"kind": "ashore"}


def objective(text=None):
    """Sets the one line at the top of the screen that tells the player what to do next.

    `text` is a short instruction, about six words, like "Follow the president".
    Pass None to give the line back to the game, which then shows its own next
    step for the year.

        yield objective("Find the club president.")
        yield objective(None)

    Longer text gets cut off, because the line only has room for one row. When
    the black bars from `movie` come down, the line goes back to the game by
    itself.
    """
    return {"kind": "objective", "text": text}


def island_tasks(tasks):
    """Sets your island's to-do list, which the player opens by clicking the line at the top of the screen.

    `tasks` is a list of rows in square brackets. Each row is a dict, which is a
    pair of curly brackets holding named values, like
    {"id": "meet", "name": "Meet the club president"}. The "id" is what you
    tick it off by, the "name" is what the player reads, and you can add a
    "note" that says where it happens.

        yield island_tasks([
            {"id": "meet", "name": "Meet the club president"},
            {"id": "program", "name": "Fix the program", "note": "On the computer"},
        ])

    Give the whole list every time, because it replaces the old one. Put it in
    `@on_start`, and rows the player already ticked stay ticked from the save.
    You can have 1 to 8 rows, each name and note can be up to 72 characters,
    and no two rows can share an id.
    """
    return {"kind": "island_tasks", "tasks": tasks}


def task_done(id):
    """Ticks one task off your island's to-do list.

    `id` is the "id" you gave that row in `island_tasks`, like "meet".

        yield task_done("meet")

    Tick it after the player has finished the thing, so the list shows how far
    they really are. The tick is saved, so it stays after the player closes the
    game, and a new school year starts the list fresh. Ticking the same row
    twice is fine. Call `island_tasks` first and use an id from that list, or
    the game stops with an error.
    """
    return {"kind": "task_done", "id": id}


def movie(on=True):
    """Puts black bars on the screen and takes the controls away, for a part the player only watches.

    `on` is True to put the bars up and False to take them down. The corner
    buttons hide while the bars are up.

        yield movie(True)
        yield say("Watch this.", who="host")
        yield movie(False)

    Everything else still works while the bars are up, like `say` and the
    camera. Always take the bars down again. `as_a_cutscene` does both for you,
    and it still takes them down if your scene stops with an error.
    """
    return {"kind": "movie", "on": bool(on)}


def as_a_cutscene(scene):
    """Runs one of your scenes with the black bars up, and always takes them down at the end.

    `scene` is your own scene function with its brackets, like `the_tour()`.

        def the_tour():
            yield say("Let me show you around.", who="host")
            yield look_at("trophies", ms=1500)

        @on_talk("host")
        def talk():
            yield from as_a_cutscene(the_tour())

    The bars come down after your last line, and they still come down if a word
    in the middle stops with an error. Write `yield from` in front of it,
    because a plain `yield` there stops with an error.
    """
    yield movie(True)
    try:
        yield from scene
    finally:
        yield movie(False)


def show(anchor, visible=True):
    """Makes the thing at a spot appear or disappear.

    `anchor` is the spot, like "trophies". It needs an object attached to it in
    MAPVIS, or the game stops with an error.
    `visible` is True to show it and False to hide it.

        yield show("trophies", False)
    """
    return {"kind": "show", "anchor": anchor, "visible": visible}


def fx(name, anchor=None, data=None):
    """Plays a short visual effect, like a spark, and your next line runs when it has finished.

    `name` is the effect: "spark", "chart_marked" or "island_rising".
    `anchor` is optional: the spot to play it at. Leave it out to play it on
    the player.
    `data` is optional: a dict like {"x": 120, "y": 80} that plays the effect
    at that point on the map, in pixels, when you give no spot.

        yield fx("spark", anchor="trophies")
    """
    intent = {"kind": "fx", "name": name}
    if anchor is not None:
        intent["anchor"] = anchor
    if data is not None:
        intent["data"] = data
    return intent


def enter(map, at=None, cover=None):
    """Takes the player to another map, the same way walking through a door does.

    `map` is the name of the map to go to, like "hub".
    `at` is the spot on that map where the player arrives. Leave it out and
    they arrive at that map's starting point, which can be far from any door.
    `cover` is optional: the picture shown while the map changes. Use
    "ceremony" for the end of a year, "passing" for a map the player only
    passes through, or the name of a cover the new map has. Leave it out and
    the new map picks its own.

        yield enter("hub", at="panthers_maw")

    Your island closes when the map changes, so nothing after this line runs.
    Set any flags before it.
    """
    intent = {"kind": "enter", "map": map}
    if at is not None:
        intent["at"] = at
    if cover is not None:
        intent["cover"] = cover
    return intent


def sail_to(map):
    """Sails the player to another island, and the game does the whole trip for them.

    `map` is the map name of the island to sail to, like "hub".

        yield sail_to("hub")

    The player walks out to the dock, gets on the boat and sails across with the
    black bars up. They step off on the other side, and that island's own
    `@on_start` runs. Nothing after this line runs, so say everything first. If
    the player is already on that island, or it has no dock, the game stops
    with an error.
    """
    return {"kind": "sail_to", "map": map}


def end_run():
    """Ends the game and goes back to the title screen.

    Nothing goes in the brackets. Use it only as the last line of the game's
    closing scene. The save is kept, and nothing after this line runs.

        yield end_run()
    """
    return {"kind": "end_run"}


def cutscene(script):
    """Always stops with an error, because the game has no stored cutscenes left to play.

    `script` is the cutscene's name.
    To make a scene, write a function of your own out of the other words and
    run it with `as_a_cutscene`.
    """
    return {"kind": "cutscene", "script": script}


# ---- the panels a player sits down with -------------------------------------

def open(ui, wait=False):
    """Opens one of the game's panels, like the planner, on top of the map.

    `ui` is the panel: "planner", "handbook", "cords", "chart", "wardrobe",
    "settings", "wall", "yearbook" or "tour". "cords" opens the Guide at its
    cords page, and "tour" is a short guided tour of the corner buttons.
    `wait=True` makes your next line wait until the player closes the panel.
    Without it, your next line runs straight away with the panel still open.

        yield open("planner", wait=True)
    """
    # this shadows the builtin `open` and costs nothing, because there is no filesystem inside the worker to open a file on, and matching the engine's word is worth more
    intent = {"kind": "open", "ui": ui}
    if wait:
        intent["wait"] = True
    return intent


# ---- doing something that gets a score --------------------------------------

def play(beat, as_plain=None, title=None, place=None, items=None):
    """Runs a scored activity, like a quiz question, and gives back the player's score.

    `beat` is a short name you pick for the activity, like "club_day". Always
    give `items` with it, because a name on its own stops with an error saying
    there is no activity called that.
    `items` is a list of questions. The one to start with is a choice question:
    a dict with "kind" set to "choice", its own "id", a "prompt" that asks the
    question, and "options", a list of at least two answers. Each answer has
    "text", a "reply" the player sees after picking it, and exactly one of them
    has "correct" set to True. Copy the `QUESTION` in
    examples/06-question/island.py and change the words.
    `title` is optional: the name shown on the activity and its result card.
    `place` is optional: the place name shown on the activity. Leave it out and
    it shows your island's place once your island is listed in the game, and
    nothing before that.
    `as_plain` no longer does anything, so leave it out.

        score = yield play("club_day", title="One question", items=[QUESTION])

    `score` is a number from 0 to 4 that the game works out for you, or None if
    the player closed the activity without finishing. The items can only hold
    text, numbers, True, False, None, lists and dicts.
    """
    # left out, `as_plain` renders the arm this player was assigned at join; True forces the plain rendering for everybody, and the game rendering cannot be forced because that would opt the control arm out of being a control
    intent = {"kind": "play", "beat": beat}
    if as_plain is not None:
        intent["as_plain"] = as_plain
    if title is not None:
        intent["title"] = title
    if place is not None:
        intent["place"] = place
    if items is not None:
        intent["items"] = items
    return intent


# ---- the run ------------------------------------------------------------------

def get(path):
    """Gives back one fact about the player's game so far, like which school year they are in.

    `path` is the name of the fact, in quotes, like `get("year")`. These are
    the names you can ask for:

    year          the school year they are in, 1 to 4
    gpa           their GPA as a number, or None before anything is graded
    tokens        how many seasons they still have free this year
    cords         a list of the ids of the honor cords they have earned
    cord_board    every cord as a dict, with how close they are to it
    trophies      {"stickers": [...], "badges": [...]}, what is on their wall
    flags         the list of flags your island has set with set_flag
    planned       True once they have stamped this year's plan
    advisory      the id of the Advisory they still owe this year, or None
    islands       the islands they have finished, as a dict like
                  {"atc": "completed"}
    handle        the name the player picked, or None
    mode          always "game"
    graduated     True once they have graduated
    phase         the step of the year they are on: "founding", "vignette",
                  "plan", "core", "class", "yearbook", "done", or None
    picks         what they picked this year, as a dict with "classes",
                  "seasons", "graded" and "gpa"
    rank          a dict about your own island, explained below

    Catch the answer with `yield` in front, like this:

        year = yield get("year")

    "phase" is "yearbook" once everything this year is done. "rank" is a dict
    like {"taken": 1, "years": [1], "best": 3.5, "rung": 0}. "taken" is how
    many years the player has finished your island, so it is 0 until they
    finish it the first time. On an island that is not listed in the game yet,
    like a practice island, it is always 0.

        been = yield get("rank")
        if been["taken"]:
            yield say("Welcome back.", who="host")

    "gpa" can be None, so check for that before you do math with it.
    """
    return {"kind": "get", "path": path}


def set_flag(flag):
    """Writes down a flag, which is a note about the player that your island can read back later.

    `flag` is the note, as short text, like "met". It stays in the player's save
    for the rest of the game.

        yield set_flag("met")

    Read your flags back with `get("flags")`:

        flags = yield get("flags")
        if "met" in flags:
            yield say("Good to see you again.", who="host")

    Each island has its own flags, so yours never mix with another island's.
    """
    return {"kind": "set_flag", "flag": flag}


def award(programme=None, grade=None, tags=None, fact=None, sticker=None, badge=None):
    """Puts your island's grade on the player's transcript, and shows a card telling them.

    `programme` is your island's id. Read it with `manifest()["programme"]` so
    you never have to type it here. `manifest` comes from grape, so add it to
    the grape line at the top of your island, like
    `from grape import manifest, on_talk`.
    `grade` is a number from 0 to 4, like the score `play` gave you. Leave it
    out to mark your island finished with no grade.
    `sticker` and `badge` are optional: the id of a sticker or badge to give.
    `fact` is optional: the id of a fact to add to the player's Handbook.
    `tags` is optional: a list of extra tags, like ["cte"], that count this
    grade toward the honor cords a player can wear at graduation.

        score = yield play("club_day", items=[QUESTION])
        if score is not None:
            yield award(programme=manifest()["programme"], grade=score)

    Check for None first, as above. None means the player did not finish, and
    passing it here would mark your island finished with no grade.

    Your island only counts as finished once it is listed in the game. Until
    then, as on a practice island, a grade is kept but nothing is marked
    finished, and the card only says "That counted."
    """
    intent = {"kind": "award"}
    for key, value in (("programme", programme), ("grade", grade), ("tags", tags),
                       ("fact", fact), ("sticker", sticker), ("badge", badge)):
        if value is not None:
            intent[key] = value
    return intent


def log(event, data=None):
    """Writes one line to the game's records for the people who run it, and the player sees nothing.

    `event` is a short name for what happened, like "island_opened".
    `data` is optional: a dict of extra details in curly brackets, like
    {"year": 2}.

        yield log("island_opened")

    Never put the player's name or anything else personal in it.
    """
    intent = {"kind": "log", "event": event}
    if data is not None:
        intent["data"] = data
    return intent
