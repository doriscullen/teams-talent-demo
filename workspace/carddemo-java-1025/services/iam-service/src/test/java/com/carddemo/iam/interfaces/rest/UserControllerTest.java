package com.carddemo.iam.interfaces.rest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private String loginToken() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\": \"ADMIN001\", \"password\": \"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("token").asText();
    }

    @Test
    void logsInWithSeededCredentials() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\": \"admin001\", \"password\": \"admin123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.expiresAt").isNotEmpty())
                .andExpect(jsonPath("$.user.userId").value("ADMIN001"))
                .andExpect(jsonPath("$.user.landingMenu").value("ADMIN"))
                .andExpect(jsonPath("$.user.password").doesNotExist())
                .andExpect(jsonPath("$.user.passwordHash").doesNotExist());
    }

    @Test
    void rejectsWrongPasswordWith401() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\": \"ADMIN001\", \"password\": \"nope1234\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    @Test
    void rejectsLoginWithoutPasswordWith400() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\": \"ADMIN001\", \"password\": \"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.details").isNotEmpty());
    }

    @Test
    void verifiesIssuedTokenAndRejectsUnknownToken() throws Exception {
        String token = loginToken();

        mockMvc.perform(post("/api/v1/auth/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new TokenBody(token))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.userId").value("ADMIN001"))
                .andExpect(jsonPath("$.userType").value("A"));

        mockMvc.perform(post("/api/v1/auth/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\": \"not-a-token\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.userId").doesNotExist());
    }

    @Test
    void listsUsersWithoutAnyPasswordField() throws Exception {
        mockMvc.perform(get("/api/v1/users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(10))
                .andExpect(jsonPath("$.total").value(5))
                .andExpect(jsonPath("$.items.length()").value(5))
                .andExpect(jsonPath("$.items[0].userId").value("ADMIN001"))
                .andExpect(jsonPath("$.items[1].userId").value("ADMIN002"))
                .andExpect(jsonPath("$.items[4].userId").value("USER0002"))
                .andExpect(jsonPath("$.items[0].passwordHash").doesNotExist());
    }

    @Test
    void returnsSingleUserAnd404ForUnknownUser() throws Exception {
        mockMvc.perform(get("/api/v1/users/{userId}", "ADMIN001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("ADMIN001"))
                .andExpect(jsonPath("$.firstName").value("System"))
                .andExpect(jsonPath("$.userType").value("A"))
                .andExpect(jsonPath("$.password").doesNotExist());

        mockMvc.perform(get("/api/v1/users/{userId}", "NOBODY01"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
    }

    @Test
    void createsUserAndReturns201() throws Exception {
        String body = """
                {"userId": "user0009", "firstName": "Ada", "lastName": "Lovelace",
                 "password": "pass1234", "userType": "U"}
                """;

        mockMvc.perform(post("/api/v1/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.userId").value("USER0009"))
                .andExpect(jsonPath("$.userType").value("U"))
                .andExpect(jsonPath("$.passwordHash").doesNotExist());

        mockMvc.perform(get("/api/v1/users")).andExpect(jsonPath("$.total").value(6));
    }

    @Test
    void rejectsDuplicateUserWith409() throws Exception {
        String body = """
                {"userId": "ADMIN001", "firstName": "Other", "lastName": "Admin",
                 "password": "pass1234", "userType": "A"}
                """;

        mockMvc.perform(post("/api/v1/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("USER_ALREADY_EXISTS"));
    }

    @Test
    void rejectsInvalidUserTypeWith400() throws Exception {
        String body = """
                {"userId": "USER0003", "firstName": "Ada", "lastName": "Lovelace",
                 "password": "pass1234", "userType": "X"}
                """;

        mockMvc.perform(post("/api/v1/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.details[0]").value("userType: User Type must be A or U."));
    }

    @Test
    void rejectsShortPasswordWith400() throws Exception {
        String body = """
                {"userId": "USER0004", "firstName": "Ada", "lastName": "Lovelace",
                 "password": "short", "userType": "U"}
                """;

        mockMvc.perform(post("/api/v1/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void refusesSelfDeletionWith409() throws Exception {
        mockMvc.perform(delete("/api/v1/users/{userId}", "ADMIN001")
                        .header("X-User-Id", "ADMIN001"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CANNOT_DELETE_SELF"));
    }

    @Test
    void refusesDeletingLastAdminWith409() throws Exception {
        mockMvc.perform(delete("/api/v1/users/{userId}", "ADMIN002")
                        .header("X-User-Id", "ADMIN001"))
                .andExpect(status().isNoContent());
        mockMvc.perform(delete("/api/v1/users/{userId}", "ADMIN003")
                        .header("X-User-Id", "ADMIN001"))
                .andExpect(status().isNoContent());

        mockMvc.perform(delete("/api/v1/users/{userId}", "ADMIN001")
                        .header("X-User-Id", "USER0001"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LAST_ADMIN"));
    }

    @Test
    void deletesRegularUserWith204() throws Exception {
        mockMvc.perform(delete("/api/v1/users/{userId}", "USER0001"))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/users/{userId}", "USER0001"))
                .andExpect(status().isNotFound());
    }

    private record TokenBody(String token) {
    }
}
