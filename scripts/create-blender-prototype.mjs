import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

const uvx = process.env.UVX_PATH || join(process.env.USERPROFILE, ".local", "bin", "uvx.exe");
const projectRoot = process.cwd().replaceAll("\\", "/");
const prototypeDir = `${projectRoot}/prototype`;
const blendPath = `${prototypeDir}/gravity-chess-3d-prototype.blend`;
const glbPath = `${prototypeDir}/gravity-chess-3d-prototype.glb`;
const previewPath = `${prototypeDir}/gravity-chess-3d-preview.png`;

const blenderCode = String.raw`
import bpy
import math
from pathlib import Path
from mathutils import Vector

OUTPUT_DIR = Path(r"${prototypeDir}")
BLEND_PATH = Path(r"${blendPath}")
GLB_PATH = Path(r"${glbPath}")
PREVIEW_PATH = Path(r"${previewPath}")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Start from a deterministic empty scene.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    bpy.data.collections.remove(collection)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for datablock in list(datablocks):
        if datablock.users == 0:
            datablocks.remove(datablock)

scene = bpy.context.scene
scene.name = "GravityChess_PrototypeScene"
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(PREVIEW_PATH)
scene.render.film_transparent = False
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.look = 'AgX - Medium High Contrast'

world = scene.world or bpy.data.worlds.new("GravityChess_World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.025, 0.032, 0.038, 1.0)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.28

def make_collection(name):
    collection = bpy.data.collections.new(name)
    scene.collection.children.link(collection)
    return collection

collections = {
    name: make_collection(name)
    for name in ("BOARD", "CELLS", "PIECES", "GRAVITY", "TOPOLOGY", "LIGHTING", "ENVIRONMENT")
}

def move_to_collection(obj, collection):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)

def make_material(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    bsdf = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = emission
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return material

materials = {
    'board': make_material('Mat_Board_Graphite', (0.16, 0.20, 0.22, 1), metallic=0.28, roughness=0.42),
    'frame': make_material('Mat_Frame_Gunmetal', (0.34, 0.39, 0.40, 1), metallic=0.56, roughness=0.3),
    'cell': make_material('Mat_Cell_Recess', (0.025, 0.033, 0.038, 1), metallic=0.20, roughness=0.5),
    'p1': make_material('Mat_Player1_Red', (0.62, 0.09, 0.13, 1), metallic=0.28, roughness=0.3),
    'p2': make_material('Mat_Player2_Gold', (0.68, 0.40, 0.13, 1), metallic=0.38, roughness=0.3),
    'gravity': make_material('Mat_Gravity_Accent', (0.24, 0.57, 0.55, 1), metallic=0.28, roughness=0.34, emission=(0.06, 0.22, 0.21, 1), emission_strength=0.7),
    'cell_rim': make_material('Mat_Cell_Rim', (0.30, 0.36, 0.37, 1), metallic=0.48, roughness=0.32),
    'obstacle': make_material('Mat_Obstacle', (0.42, 0.46, 0.48, 1), metallic=0.62, roughness=0.34),
    'ground': make_material('Mat_Ground', (0.055, 0.065, 0.07, 1), metallic=0.0, roughness=0.8),
}

def empty(name, collection, parent=None):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = 0.35
    if parent:
        obj.parent = parent
    return obj

def finish_mesh(obj, collection, material, parent=None, bevel=0.0, smooth=False):
    move_to_collection(obj, collection)
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new(name='WebBevel', type='BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    return obj

def cube(name, location, scale, collection, material, parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, collection, material, parent, bevel)

def cylinder(name, location, radius, depth, collection, material, parent=None, rotation=(0, 0, 0), vertices=32, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, collection, material, parent, bevel, smooth=True)

def torus(name, location, major_radius, minor_radius, collection, material, parent=None, rotation=(math.pi / 2, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=32,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, collection, material, parent, smooth=True)

root = empty('GravityChess_Prototype', collections['BOARD'])
root['asset_role'] = 'prototype_root'
root['coordinate_convention'] = 'X=column, Z=row, Y=depth; row 0 is top'
root['runtime_rules'] = 'TypeScript GameEngine remains authoritative'

board = empty('Board', collections['BOARD'], root)
board['rows'] = 5
board['cols'] = 7
board['cell_spacing'] = 1.18
board['render_role'] = 'visual_only'
cells_root = empty('Cells', collections['CELLS'], board)
pieces_root = empty('Pieces', collections['PIECES'], root)
gravity_root = empty('GravityIndicator', collections['GRAVITY'], root)
topology_root = empty('TopologyIndicators', collections['TOPOLOGY'], root)

rows, cols = 5, 7
spacing = 1.18
center_z = 3.62
board_width = (cols - 1) * spacing + 0.98
board_height = (rows - 1) * spacing + 0.98

# A shallow gunmetal frame and graphite inlay replace the old rails and support assembly.
cube('Board_Frame', (0, 0.03, center_z), (board_width / 2, 0.16, board_height / 2), collections['BOARD'], materials['frame'], board, bevel=0.18)
cube('Board_Inlay', (0, -0.12, center_z), ((board_width - 0.34) / 2, 0.11, (board_height - 0.34) / 2), collections['BOARD'], materials['board'], board, bevel=0.13)

for row in range(rows):
    for col in range(cols):
        x = (col - (cols - 1) / 2) * spacing
        z = center_z + ((rows - 1) / 2 - row) * spacing
        cell = cylinder(
            f'Cell_{row:02d}_{col:02d}',
            (x, -0.24, z),
            0.405,
            0.07,
            collections['CELLS'],
            materials['cell'],
            cells_root,
            rotation=(math.pi / 2, 0, 0),
            vertices=24,
            bevel=0.018,
        )
        cell['row'] = row
        cell['col'] = col
        rim = torus(
            f'Cell_Rim_{row:02d}_{col:02d}',
            (x, -0.29, z),
            0.435,
            0.026,
            collections['CELLS'],
            materials['cell_rim'],
            cells_root,
            rotation=(math.pi / 2, 0, 0),
        )
        rim['row'] = row
        rim['col'] = col

def cell_position(row, col, y=-0.37):
    return (
        (col - (cols - 1) / 2) * spacing,
        y,
        center_z + ((rows - 1) / 2 - row) * spacing,
    )

def piece(name, row, col, player):
    obj = cylinder(
        name,
        cell_position(row, col),
        0.40,
        0.19,
        collections['PIECES'],
        materials['p1' if player == 1 else 'p2'],
        pieces_root,
        rotation=(math.pi / 2, 0, 0),
        vertices=32,
        bevel=0.06,
    )
    obj['player'] = player
    obj['row'] = row
    obj['col'] = col
    return obj

piece('Piece_Player1', 4, 2, 1)
piece('Piece_Player2', 4, 3, 2)
piece('Piece_Demo_Player1_01', 4, 0, 1)
piece('Piece_Demo_Player2_01', 4, 1, 2)
piece('Piece_Demo_Player1_02', 3, 1, 1)
piece('Piece_Demo_Player2_02', 3, 3, 2)
piece('Piece_Demo_Player1_03', 2, 3, 1)

obstacle = cube('Piece_Obstacle', cell_position(4, 5, -0.43), (0.39, 0.13, 0.39), collections['PIECES'], materials['obstacle'], pieces_root, bevel=0.1)
obstacle['cell_value'] = -1
obstacle['row'] = 4
obstacle['col'] = 5

# The gravity cue belongs to the active edge, not beside the board as a floating sign.
gravity_z = center_z - board_height / 2 - 0.16
cube('GravityIndicator_Edge', (0, -0.31, gravity_z), (max(0.9, board_width * 0.15), 0.025, 0.035), collections['GRAVITY'], materials['gravity'], gravity_root, bevel=0.025)
bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=0.0, radius2=0.105, depth=0.21, location=(0, -0.33, gravity_z - 0.09))
gravity_head = bpy.context.object
gravity_head.name = 'GravityIndicator_Head'
finish_mesh(gravity_head, collections['GRAVITY'], materials['gravity'], gravity_root, smooth=True)
gravity_root['default_direction'] = 'down'
gravity_root['runtime_behavior'] = 'move to the top or bottom edge; pulse emission only'

# Topology remains a rule concept. The runtime can add a muted edge inset when needed.
topology_root['runtime_only'] = True

# A quiet floor receives the board shadow; the board itself has no supporting base.
cube('Prototype_Ground', (0, 1.2, 0.02), (8.0, 7.0, 0.04), collections['ENVIRONMENT'], materials['ground'], root, bevel=0.03)

def add_area_light(name, location, energy, color, size):
    data = bpy.data.lights.new(name, type='AREA')
    data.energy = energy
    data.color = color
    data.shape = 'DISK'
    data.size = size
    obj = bpy.data.objects.new(name, data)
    collections['LIGHTING'].objects.link(obj)
    obj.location = location
    obj.parent = root
    return obj

def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

key = add_area_light('Light_Key', (-4.5, -6.5, 10.5), 980, (1.0, 0.88, 0.76), 5.6)
look_at(key, (0, 0, center_z))
fill = add_area_light('Light_Fill', (5.0, -3.0, 7.0), 620, (0.68, 0.76, 0.78), 4.5)
look_at(fill, (0, 0, center_z))
rim = add_area_light('Light_Rim', (0, 3.5, 8.5), 520, (0.48, 0.68, 0.70), 3.5)
look_at(rim, (0, 0, center_z + 0.5))

camera_data = bpy.data.cameras.new('Camera')
camera = bpy.data.objects.new('Camera', camera_data)
collections['ENVIRONMENT'].objects.link(camera)
camera.location = (6.8, -15.8, 8.1)
camera_data.lens = 57
camera_data.sensor_width = 36
camera_data.dof.use_dof = False
look_at(camera, (0.35, 0, 3.35))
scene.camera = camera

# Exportable metadata supports an adapter without making Blender authoritative.
scene['prototype_version'] = '2.0.0'
scene['board_mapping'] = 'x=(col-(cols-1)/2)*spacing; z=centerZ+((rows-1)/2-row)*spacing'
scene['gravity_mapping'] = 'down=-Z; up=+Z'
scene['topology_note'] = 'wrapHorizontal/wrapVertical are portals, not gravity directions'

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
bpy.ops.export_scene.gltf(
    filepath=str(GLB_PATH),
    export_format='GLB',
    export_apply=True,
    export_cameras=True,
    export_lights=True,
    export_extras=True,
)
scene.render.filepath = str(PREVIEW_PATH)
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

summary = {
    'blend': str(BLEND_PATH),
    'glb': str(GLB_PATH),
    'preview': str(PREVIEW_PATH),
    'objects': len(bpy.data.objects),
    'meshes': len(bpy.data.meshes),
    'materials': len(bpy.data.materials),
    'triangles_estimate': sum(len(obj.data.loop_triangles) for obj in bpy.data.objects if obj.type == 'MESH'),
}
print('GRAVITY_CHESS_PROTOTYPE_CREATED', summary)
`;

const child = spawn(uvx, ["--python", "3.11", "blender-mcp"], {
  env: {
    ...process.env,
    BLENDER_HOST: "127.0.0.1",
    BLENDER_PORT: "9876",
    DISABLE_TELEMETRY: "true",
    UV_PYTHON_PREFERENCE: "only-managed",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stdoutBuffer = "";
let stderr = "";
let finished = false;
let advertisedTools = [];

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function finish(error, result) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  child.stdin.end();
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill();
  }

  if (error) {
    console.error(JSON.stringify({ ok: false, error, advertisedTools, stderr: stderr.slice(-6000) }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ ok: true, advertisedTools, ...result }, null, 2));
}

function handleMessage(message) {
  if (message.id === 1) {
    if (message.error) return finish(`initialize failed: ${message.error.message}`);
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    return;
  }

  if (message.id === 2) {
    if (message.error) return finish(`tools/list failed: ${message.error.message}`);
    const tools = message.result?.tools || [];
    advertisedTools = tools.map((tool) => tool.name);
    const executeTool = tools.find((tool) => tool.name === "execute_blender_code");
    if (!executeTool) return finish("execute_blender_code was not advertised by the MCP server");
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "execute_blender_code",
        arguments: {
          code: blenderCode,
          user_prompt: "Create the approved lightweight Gravity Chess 3D web prototype, save .blend, export GLB, and render a preview.",
        },
      },
    });
    return;
  }

  if (message.id === 3) {
    if (message.error) return finish(`execute_blender_code failed: ${message.error.message}`);
    const response = message.result?.content?.find((item) => item.type === "text")?.text || "";
    if (message.result?.isError || /Error executing code/i.test(response)) {
      return finish(`Blender tool call failed: ${response || "unknown error"}`);
    }
    finish(null, {
      response,
      outputs: { blendPath, glbPath, previewPath },
    });
  }
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch {
      stderr += `Non-JSON stdout: ${line}\n`;
    }
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.on("error", (error) => finish(`could not start uvx: ${error.message}`));
child.on("exit", (code) => {
  if (!finished) finish(`MCP server exited before prototype creation completed (code ${code})`);
});

const timeout = setTimeout(() => finish("MCP prototype creation timed out after 300 seconds"), 300_000);

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "gravity-chess-prototype-builder", version: "1.0.0" },
  },
});
