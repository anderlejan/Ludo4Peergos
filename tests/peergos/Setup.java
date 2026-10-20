import peergos.server.Builder;
import peergos.shared.Crypto;
import peergos.shared.NetworkAccess;
import peergos.shared.social.FollowRequestWithCipherText;
import peergos.shared.user.SocialState;
import peergos.shared.user.UserContext;

import java.net.URI;
import java.util.*;

/** Test fixture for the end-to-end test against a LOCAL throw-away Peergos server:
 *  signs up the given users (password = the same for all) and makes the first one friends with each other one.
 *
 *  java -cp Peergos.jar tests/peergos/Setup.java http://localhost:8777 testpassword alice bob
 */
public class Setup {
    public static void main(String[] args) throws Exception {
        String url = args[0], password = args[1];
        List<String> users = Arrays.asList(args).subList(2, args.length);
        Crypto crypto = Builder.initCrypto();
        Map<String, UserContext> ctx = new LinkedHashMap<>();
        for (String u : users) {
            NetworkAccess net = Builder.buildJavaNetworkAccess(URI.create(url).toURL(), false, Optional.empty(), Optional.empty()).join();
            try {
                ctx.put(u, UserContext.signUp(u, password, "", net, crypto).join());
                System.out.println("signed up " + u);
            } catch (Exception e) {
                ctx.put(u, UserContext.signIn(u, password, mfa -> null, net, crypto).join());
                System.out.println("signed in " + u);
            }
        }
        String host = users.get(0);
        for (String other : users.subList(1, users.size())) {
            befriend(ctx.get(host), ctx.get(other));
            System.out.println("friends: " + host + " + " + other);
        }
        System.out.println("SETUP DONE");
        System.exit(0);
    }

    static void befriend(UserContext a, UserContext b) throws Exception {
        for (int i = 0; i < 10; i++) {
            try { a.sendInitialFollowRequest(b.username).join(); break; }
            catch (Exception e) { Thread.sleep(1000); }
        }
        for (int i = 0; i < 60; i++) {
            SocialState s = b.getSocialState().join();
            Optional<FollowRequestWithCipherText> req = s.pendingIncoming.stream()
                    .filter(r -> a.username.equals(r.getEntry().ownerName)).findFirst();
            if (req.isPresent()) {
                b.sendReplyFollowRequest(req.get(), true, true).join();
                break;
            }
            Thread.sleep(1000);
        }
        for (int i = 0; i < 60; i++) {
            SocialState s = a.getSocialState().join();
            if (s.getFriends().contains(b.username)) return;
            Thread.sleep(1000);
        }
        throw new IllegalStateException("friendship " + a.username + " / " + b.username + " did not complete");
    }
}
