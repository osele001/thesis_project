import com.mongodb.BasicDBObject;
import com.mongodb.MongoClient;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoCursor;
import com.mongodb.client.MongoDatabase;
import org.bson.Document;
import org.json.JSONObject;

import javax.websocket.*;
import javax.websocket.server.ServerEndpoint;
import java.io.IOException;
import java.util.*;

@ServerEndpoint(value = "/websocket")
public class ChatEndpoint {

    private static final String motd = "Welcome to my web chat server!\nPeople online: [online_count], take a look who is online: [online];";

    private MongoClient mongoClient = new MongoClient();
    private MongoDatabase database = mongoClient.getDatabase("mydb");
    private MongoCollection<Document> userListDB = database.getCollection("users");
    private MongoCollection<Document> chatDB = database.getCollection("chat");

    private Map colors = new HashMap<>();
    private static final Map<Session, String> peers = Collections.synchronizedMap(new HashMap<Session, String>());
    private static final Map<Session, Boolean> auth = Collections.synchronizedMap(new HashMap<Session, Boolean>());

    @OnOpen
    public void onOpen(Session peer) {
    }

    @OnClose
    public void onClose(Session peer) throws IOException, EncodeException {
        broadcast("[server]", peers.get(peer) + " left the chat!");
        peers.remove(peer);
    }

    @OnMessage
    public void message(String message, Session client) throws IOException, EncodeException {

        String login;
        JSONObject event = new JSONObject(message);

        if (event.getString("type").equals("authorize")) {

            if (checkUser(event.getString("user"), event.getString("password"))) {

                JSONObject returning = new JSONObject();
                returning.put("type", "authorize");
                returning.put("success", true);
                returning.put("online", peers.values());

                login = event.getString("user");

                if (peers.containsKey(client)) peers.remove(client);
                if (auth.containsKey(client)) auth.remove(client);
                peers.put(client, login);
                auth.put(client, true);

                broadcast("[server]", login + " joined the chat!");

                client.getBasicRemote().sendObject(returning);

                sendNewMessages(client);

                JSONObject welcomeMSG = new JSONObject();
                welcomeMSG.put("type", "message");
                welcomeMSG.put("message", motd);
                welcomeMSG.put("from", "[server]");
                welcomeMSG.put("time", new Date());
                welcomeMSG.put("color", "transparent");
                client.getBasicRemote().sendObject(welcomeMSG);
            }
        }
        if (event.getString("type").equals("message")) {
            if (auth.get(client)) {
                broadcast(peers.get(client), event.getString("message"));
            }
        }
    }

    private boolean checkUser(String user, String password) {
        if (userListDB.count(new BasicDBObject("login", user)) > 0) {
            return new BasicDBObject(userListDB.find(new BasicDBObject("login", user)).first()).get("password").equals(password);
        } else {
            userListDB.insertOne(new Document("login", user).append("password", password).append("color", get_random_color()));
            return true;
        }
    }

    private String get_random_color() {
        Random rand = new Random();
        int r = rand.nextInt(255);
        int g = rand.nextInt(255);
        int b = rand.nextInt(255);
        return String.format("#%02X%02X%02X", r, g, b);
    }

    private String colorOf(String name) {
        String color;
        if (name.equals("[server]")) {
            return "transparent";
        }
        if (!colors.containsKey(name)) {
            BasicDBObject usr = new BasicDBObject(userListDB.find(new BasicDBObject("login", name)).first());
            if (!usr.containsField("color")) {
                color = get_random_color();
                userListDB.updateOne(usr, usr.append("color", color));
            } else {
                color = usr.get("color").toString();
            }
            colors.put(name, color);
            return color;
        } else {
            return colors.get(name).toString();
        }
    }

    private void broadcast(String by, String message) throws IOException, EncodeException {
        long time = new Date().getTime();
        JSONObject msg = new JSONObject();
        msg.put("type", "message");
        msg.put("message", message);
        msg.put("from", by);
        msg.put("time", time);
        msg.put("color", colorOf(by));

        for (Session peer : peers.keySet()) {
            peer.getBasicRemote().sendObject(msg);
        }
        if (by.equals("[server]")) {
            return;
        }
        chatDB.insertOne(new Document("message", message).append("from", by).append("color", colorOf(by)));
    }

    private void sendNewMessages(Session client) throws IOException, EncodeException {
        MongoCursor<Document> cursor = chatDB.find().sort(new Document("time", 1)).limit(50).iterator();
        try {
            while (cursor.hasNext()) {
                Document current = cursor.next();
                current.append("type", "message");
                JSONObject msg = new JSONObject(current.toJson());
                client.getBasicRemote().sendObject(msg);
            }
        } finally {
            cursor.close();
        }
    }
}
